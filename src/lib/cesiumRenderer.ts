import type { Cartesian3, Entity, Viewer } from "cesium";
import {
  arcLift,
  buildRouteGeometry,
  cssColor,
  dayPalette,
  DayVisualState,
  frameRouteBesidePanel,
  lateralPanelBiasM,
  RouteGeometry,
  routeViewHeadingDeg,
  sampleRouteAltitude,
  STEM_HEIGHT_M,
} from "@/lib/mapRoute";
import {
  CameraPose,
  CameraState,
  CITY_BOUNDARY_HEIGHT_M,
  drawnDaysOf,
  FlyToPointOptions,
  FrameRouteOptions,
  HERO_VIEW,
  HIGHWAY_CASING,
  HIGHWAY_COLOR,
  HIGHWAY_HEIGHT_M,
  LABEL_COLOR,
  LABEL_OUTLINE,
  MapRenderer,
  MIN_ROUTE_RADIUS_M,
  panelLeftEdgePx,
  PIN_IMAGE,
  ROUTE_FRAME_PITCH_DEG,
  RouteDrawRequest,
  ScreenPoint,
  visibleMapWidthPx,
  ZoomStepOptions,
} from "@/lib/mapRenderer";

/** Cesium is only ever reached through `await import("cesium")`, so the helpers below take the
 *  module as a parameter rather than importing it — same contract as mapRoute's. */
type CesiumModule = typeof import("cesium");

interface CesiumPose {
  position: Cartesian3;
  heading: number;
  pitch: number;
  roll: number;
}

/**
 * Half the camera's *horizontal* field of view, as a tangent, for turning screen pixels into
 * metres at a given depth.
 *
 * Derived from `fovy` and the aspect ratio rather than read off `frustum.fov`, which is the
 * horizontal angle only while the canvas is wider than it is tall and silently becomes the
 * vertical one when it is not. Returns undefined in 2D, where the frustum is orthographic and has
 * no field of view at all — `frameRouteBesidePanel` then falls back to Cesium's 60° default,
 * which is the right kind of wrong: a slightly off-centre aim, not a thrown error.
 */
function horizontalTanHalfFov(viewer: Viewer): number | undefined {
  const frustum = viewer.camera.frustum as { fovy?: number; aspectRatio?: number };
  if (typeof frustum.fovy !== "number" || typeof frustum.aspectRatio !== "number") return undefined;
  return Math.tan(frustum.fovy / 2) * frustum.aspectRatio;
}

/**
 * The `MapRenderer` over a CesiumJS viewer.
 *
 * Every line of Cesium the app used to run out of `mapCamera.tsx`, `MapControls` and
 * `StopMarkerLayer` lives here now, moved rather than rewritten — the comments on each piece are
 * the original ones, and they are load-bearing. Nothing above this file imports `cesium`.
 *
 * The renderer is constructed by `GlobeBackground` once the 3D tileset has loaded, and handed to
 * the provider through `setRenderer`. It never outlives its viewer.
 */
export class CesiumRenderer implements MapRenderer {
  readonly engine = "cesium" as const;

  private readonly viewer: Viewer;
  private readonly Cesium: CesiumModule;

  private pinEntity: Entity | null = null;
  private routeEntities: Entity[] = [];
  /** Indexed *by day index*, holes and all, so emphasis can look a day up directly. */
  private routeGeometries: RouteGeometry[] = [];
  private highwayEntities: Entity[] = [];
  private cityEntities: Entity[] = [];
  /** Bumped per draw so a slow height sample from an older trip can't reposition the new one. */
  private drawGeneration = 0;

  constructor(viewer: Viewer, cesium: CesiumModule) {
    this.viewer = viewer;
    this.Cesium = cesium;
  }

  isAlive() {
    return !this.viewer.isDestroyed();
  }

  requestRender() {
    if (this.isAlive()) this.viewer.scene.requestRender();
  }

  // ---------------------------------------------------------------- overlays

  async drawRoute(request: RouteDrawRequest): Promise<number> {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return request.altitudeHintM;
    const generation = ++this.drawGeneration;

    this.clearRoute();
    const flat = request.days.flat();
    if (flat.length === 0) return request.altitudeHintM;

    // The same days the framing works on, because the height probe needs their ground positions
    // and nothing else here does. Through `drawnDaysOf` so the camera and the probe cannot
    // disagree about which days are on screen.
    const drawnPositions = drawnDaysOf(request.days, request.focusDay)
      .flat()
      .map((st) => Cesium.Cartesian3.fromDegrees(st.lng, st.lat));

    // Drawn immediately at the last route's altitude and corrected once the real sample lands,
    // rather than awaiting first. Height sampling takes ~1.3s alone but several seconds when
    // day-tab clicks stack the requests up, which left the map visibly empty. Consecutive days
    // of one trip share a city, so the previous altitude is a near-perfect stand-in; the very
    // first route falls back to 0 and visibly settles once.
    const altitudeAtDraw = request.altitudeHintM;

    // Holes are deliberate. `routeGeometries` stays indexed by day index so the emphasis path can
    // look a day up directly; under `soloFocus` every slot but one is empty, and
    // `forEach`/`flatMap` skip holes rather than visiting undefined.
    //
    // Two readings of "select a day", and they belong to different surfaces. `soloFocus` — the
    // itinerary panel: picking a day means "show me this day", and the answer is that day and
    // nothing else. Otherwise — the split editor: every day stays drawn and the unselected ones
    // dim, because a cross-day drag is a decision about two days and hiding one hides half of it.
    const geometries: RouteGeometry[] = [];
    request.days.forEach((stops, day) => {
      if (request.soloFocus && request.focusDay !== null && day !== request.focusDay) return;
      const geometry = buildRouteGeometry(viewer, Cesium, stops, altitudeAtDraw, dayPalette(day));
      geometry.setDayState(request.stateFor(day));
      geometries[day] = geometry;
    });
    this.routeEntities = geometries.flatMap((g) => g.entities);
    this.routeGeometries = geometries;

    // One sample across everything drawn, not one per day: `clampToHeightMostDetailed` is the
    // expensive part (~1.3s for a single day) and the days of one trip share a city, so sampling
    // each separately would multiply the wait by the trip length to land on near-identical
    // answers — and any disagreement between them would step the days onto visibly different
    // planes in the overview.
    const altitude = await sampleRouteAltitude(viewer, Cesium, drawnPositions);
    // A fast day-tab switch can land a newer route mid-sample; the newest request wins, and a
    // superseded generation's entities are already gone from the collection.
    if (generation !== this.drawGeneration || !this.isAlive()) return altitude;
    if (Math.abs(altitude - altitudeAtDraw) >= 0.5) {
      geometries.forEach((geometry) => geometry.reposition(altitude));
    }
    return altitude;
  }

  clearRoute() {
    if (!this.isAlive()) return;
    for (const e of this.routeEntities) this.viewer.entities.remove(e);
    this.routeEntities = [];
    this.routeGeometries = [];
  }

  applyDayStates(stateFor: (day: number) => DayVisualState) {
    this.routeGeometries.forEach((geometry, day) => geometry.setDayState(stateFor(day)));
    // Load-bearing under `requestRenderMode`: recolouring a material moves nothing, so without a
    // frame requested the change is not drawn until some unrelated camera move repaints.
    this.requestRender();
  }

  applyEmphasis(dayIndex: number | null, indexWithinDay: number | null) {
    // Every other day is explicitly cleared rather than left alone: without that, moving the
    // pointer from a stop on day 2 to one on day 5 leaves day 2's stem amber and the trip shows
    // two "you are pointing at this".
    this.routeGeometries.forEach((geometry, day) =>
      geometry.setEmphasis(day === dayIndex ? indexWithinDay : null)
    );
    this.requestRender();
  }

  setPin(pin: { lat: number; lng: number; label?: string } | null) {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return;
    // One marker at a time: the pin always sits wherever the camera last flew, so a labelless
    // flight (the global reset) just clears it.
    if (this.pinEntity) viewer.entities.remove(this.pinEntity);
    this.pinEntity = null;
    if (!pin?.label) return;
    this.pinEntity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(pin.lng, pin.lat),
      billboard: {
        image: PIN_IMAGE,
        width: 30,
        height: 40,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        // Without this the photorealistic tiles bury the pin inside nearby buildings.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: pin.label,
        font: '500 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        fillColor: Cesium.Color.fromCssColorString(LABEL_COLOR),
        outlineColor: Cesium.Color.fromCssColorString(LABEL_OUTLINE),
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -44),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  drawHighways(segments: { points: { lat: number; lng: number }[] }[]) {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return;
    for (const e of this.highwayEntities) viewer.entities.remove(e);
    this.highwayEntities = segments.map((segment) =>
      viewer.entities.add({
        polyline: {
          positions: segment.points.map((p) =>
            Cesium.Cartesian3.fromDegrees(p.lng, p.lat, HIGHWAY_HEIGHT_M)
          ),
          width: 3,
          arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineOutlineMaterialProperty({
            color: Cesium.Color.fromCssColorString(HIGHWAY_COLOR),
            outlineColor: Cesium.Color.fromCssColorString(HIGHWAY_CASING),
            outlineWidth: 1,
          }),
          // HIGHWAY_HEIGHT_M is a fixed height above the *ellipsoid*, not local terrain — the real
          // ground surface is routinely tens of metres higher (see sampleRouteAltitude's own
          // comment on this), so the line sits *below* the visible 3D-tile surface almost
          // everywhere and would otherwise fail the depth test and never be seen. Sampling real
          // terrain height per vertex isn't worth it for a query that can return hundreds of
          // points, so instead draw the full-strength colour on depth-fail too.
          depthFailMaterial: new Cesium.ColorMaterialProperty(
            Cesium.Color.fromCssColorString(HIGHWAY_COLOR)
          ),
        },
      })
    );
  }

  drawCityBoundary(segments: { lat: number; lng: number }[][]) {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return;
    for (const e of this.cityEntities) viewer.entities.remove(e);
    // Outline only, never a fill. A translucent polygon over photorealistic terrain hides the
    // city it is describing, which is the one thing this must not do.
    this.cityEntities = segments.map((segment) =>
      viewer.entities.add({
        polyline: {
          positions: segment.map((p) =>
            Cesium.Cartesian3.fromDegrees(p.lng, p.lat, CITY_BOUNDARY_HEIGHT_M)
          ),
          width: 2,
          arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.ColorMaterialProperty(
            Cesium.Color.fromCssColorString(cssColor("--city-boundary")).withAlpha(0.85)
          ),
          // Full strength on depth-fail, which is the *normal* case rather than the exception.
          // `CITY_BOUNDARY_HEIGHT_M` is a height above the ellipsoid and the real tile surface is
          // routinely tens of metres higher, so this line is below the visible ground almost
          // everywhere. A dimmed depth-fail material therefore isn't "the occluded parts are
          // subtler", it is the whole line at that alpha — which is why the first attempt drew
          // nothing anybody could see. Solid rather than dashed for the same reason: a dash
          // material has no depth-fail equivalent.
          depthFailMaterial: new Cesium.ColorMaterialProperty(
            Cesium.Color.fromCssColorString(cssColor("--city-boundary")).withAlpha(0.85)
          ),
        },
      })
    );
    this.requestRender();
  }

  clearOverlays() {
    if (!this.isAlive()) return;
    this.drawGeneration++;
    this.clearRoute();
    for (const e of this.highwayEntities) this.viewer.entities.remove(e);
    this.highwayEntities = [];
    for (const e of this.cityEntities) this.viewer.entities.remove(e);
    this.cityEntities = [];
    this.setPin(null);
  }

  // ---------------------------------------------------------------- camera

  flyToPoint(options: FlyToPointOptions) {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return;
    const heading = options.headingRad ?? 0;

    // Centre the stop in the strip the itinerary leaves, not in the window.
    //
    // Dead centre of a 1440px window is 720px in — well inside the 40%-wide panel — so hovering a
    // row flew the camera to a point that landed *behind* the plan being read. The route framing
    // has corrected for this since it existed (`frameRouteBesidePanel`); a stop flight never did,
    // and it is the same question. Same correction, same helper, both engines.
    //
    // The shove runs along the camera's own *right*, not along world east — see `frameRoute` for
    // why those stop being the same vector the moment the camera turns.
    const viewWidth = viewer.scene.canvas.clientWidth;
    const biasM = lateralPanelBiasM(
      options.rangeM,
      viewWidth,
      visibleMapWidthPx(viewWidth),
      horizontalTanHalfFov(viewer)
    );
    let target = Cesium.Cartesian3.fromDegrees(
      options.lng,
      options.lat,
      options.centreHeightM ?? 0
    );
    if (biasM !== 0) {
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(target);
      const east = Cesium.Cartesian3.fromCartesian4(
        Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4())
      );
      const north = Cesium.Cartesian3.fromCartesian4(
        Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian4())
      );
      const right = Cesium.Cartesian3.subtract(
        Cesium.Cartesian3.multiplyByScalar(east, Math.cos(heading), new Cesium.Cartesian3()),
        Cesium.Cartesian3.multiplyByScalar(north, Math.sin(heading), new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      target = Cesium.Cartesian3.add(
        target,
        Cesium.Cartesian3.multiplyByScalar(right, biasM, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
    }

    // Frame the target rather than hovering over it: `camera.flyTo` puts the camera *at* these
    // coordinates, so at a downward pitch the place itself sits at nadir, outside the frustum —
    // you'd fly to Rome and never see Rome. A bounding sphere keeps it centred, with `rangeM`
    // read as distance-to-target instead of altitude.
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
      offset: new Cesium.HeadingPitchRange(
        heading,
        Cesium.Math.toRadians(options.pitchDeg),
        options.rangeM
      ),
      duration: options.durationS ?? 2.5,
    });
  }

  frameRoute({ days, focusDay, panelVisible, routeAltitudeM, durationS }: FrameRouteOptions) {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return;
    // Frame the focused day if there is one, otherwise the whole trip. Selecting a day is an
    // explicit "show me this", so this deliberately overrides wherever the user had dragged the
    // camera.
    const drawnDays = drawnDaysOf(days, focusDay);
    const drawnStops = drawnDays.flat();
    if (drawnStops.length === 0) return;
    const drawnPositions = drawnStops.map((st) => Cesium.Cartesian3.fromDegrees(st.lng, st.lat));

    // The stops *and* the apex of every arc between them. Framing the stops alone was right while
    // arcs bowed 180m; they now peak at a fraction of the hop's ground length, so a cross-city day
    // arches kilometres up and the camera cut the tops off — worse at `ROUTE_FRAME_PITCH_DEG`,
    // which trades frame height for exactly the elevation this sphere now has to contain. Grouped
    // by day rather than run across the flat list: two consecutive days are joined in `flat` by a
    // pair that no arc is ever drawn between, and reserving room for that phantom hop would pull
    // the whole trip's overview back.
    const framePositions = [...drawnPositions];
    for (const stops of drawnDays) {
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1];
        const b = stops[i];
        const span = Cesium.Cartesian3.distance(
          Cesium.Cartesian3.fromDegrees(a.lng, a.lat),
          Cesium.Cartesian3.fromDegrees(b.lng, b.lat)
        );
        framePositions.push(
          Cesium.Cartesian3.fromDegrees(
            (a.lng + b.lng) / 2,
            (a.lat + b.lat) / 2,
            routeAltitudeM + STEM_HEIGHT_M + arcLift(span)
          )
        );
      }
    }
    const sphere = Cesium.BoundingSphere.fromPoints(framePositions);
    const radius = Math.max(sphere.radius, MIN_ROUTE_RADIUS_M);
    // Aim at the middle of the strip the panel leaves, not the middle of the viewport.
    const viewWidth = viewer.scene.canvas.clientWidth;
    const { biasM, rangeM } = frameRouteBesidePanel(
      radius,
      viewWidth,
      panelLeftEdgePx(panelVisible, viewWidth),
      horizontalTanHalfFov(viewer)
    );
    // Face the route across its long axis rather than down it — see `routeViewHeadingDeg`.
    const headingDeg = routeViewHeadingDeg(drawnStops);
    const heading = Cesium.Math.toRadians(headingDeg);

    // The panel bias has to run along the camera's own *right*, not along world east.
    //
    // Those were the same vector for as long as the heading was hardcoded to north, and the bias
    // was written as "shove the aim point east" on that basis. They stop being the same the moment
    // the camera turns: at heading 90 world east is straight into the screen, so an east-shifted
    // aim point would push the route away from the camera instead of sideways out from under the
    // panel. Screen-right in the local frame is (cos h, -sin h) over (east, north) — at h = 0 that
    // is east, which is exactly the old behaviour, so a north-facing route is bit-identical.
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(sphere.center);
    const east = Cesium.Cartesian3.fromCartesian4(
      Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4())
    );
    const north = Cesium.Cartesian3.fromCartesian4(
      Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian4())
    );
    const right = Cesium.Cartesian3.subtract(
      Cesium.Cartesian3.multiplyByScalar(east, Math.cos(heading), new Cesium.Cartesian3()),
      Cesium.Cartesian3.multiplyByScalar(north, Math.sin(heading), new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    const target = Cesium.Cartesian3.add(
      sphere.center,
      Cesium.Cartesian3.multiplyByScalar(right, biasM, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, radius), {
      offset: new Cesium.HeadingPitchRange(
        heading,
        Cesium.Math.toRadians(ROUTE_FRAME_PITCH_DEG),
        rangeM
      ),
      duration: durationS ?? 2.0,
    });
  }

  flyHome(durationS = 2.0) {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return;
    // camera.flyTo directly rather than `flyToPoint`, which layers this app's own pitch/range
    // conventions on top of a destination — this wants the raw hero pose.
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(HERO_VIEW.lng, HERO_VIEW.lat, HERO_VIEW.heightM),
      orientation: {
        heading: Cesium.Math.toRadians(HERO_VIEW.headingDeg),
        pitch: Cesium.Math.toRadians(HERO_VIEW.pitchDeg),
        roll: 0,
      },
      duration: durationS,
    });
  }

  cameraState(): CameraState | null {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return null;
    // The point under the middle of the screen, which is what the other engine will centre on.
    // `pickCentre` walks its own fallback chain, so this answers even when the boresight is aimed
    // at sky and there is no tile to hit.
    const centre = this.pickCentre();
    const carto = Cesium.Cartographic.fromCartesian(centre);
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lng: Cesium.Math.toDegrees(carto.longitude),
      rangeM: Cesium.Cartesian3.distance(viewer.camera.positionWC, centre),
      headingRad: viewer.camera.heading,
      pitchDeg: Cesium.Math.toDegrees(viewer.camera.pitch),
    };
  }

  restoreCamera(state: CameraState) {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return;
    // `duration: 0` rather than `setView`: `flyToBoundingSphere` is what every other framing in
    // this file goes through, so a zero-length flight lands on exactly the pose the others would
    // have flown to. `setView` places the camera *at* the destination, which is the trap
    // `flyToPoint` documents.
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(state.lng, state.lat), 0),
      {
        offset: new Cesium.HeadingPitchRange(
          state.headingRad,
          Cesium.Math.toRadians(state.pitchDeg),
          state.rangeM
        ),
        duration: 0,
      }
    );
  }

  capturePose(): CameraPose | null {
    if (!this.isAlive()) return null;
    const { camera } = this.viewer;
    return {
      position: camera.position.clone(),
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
    } satisfies CesiumPose;
  }

  flyToPose(pose: CameraPose, durationS: number, onArrive?: () => void) {
    if (!this.isAlive()) return;
    const home = pose as CesiumPose;
    this.viewer.camera.flyTo({
      destination: home.position,
      orientation: { heading: home.heading, pitch: home.pitch, roll: home.roll },
      duration: durationS,
      complete: onArrive,
    });
  }

  poseHeadingRad(pose: CameraPose) {
    return (pose as CesiumPose).heading;
  }

  posePitchRad(pose: CameraPose) {
    return (pose as CesiumPose).pitch;
  }

  distanceFromPoseM(pose: CameraPose, lat: number, lng: number, heightM: number) {
    const { Cesium } = this;
    return Cesium.Cartesian3.distance(
      (pose as CesiumPose).position,
      Cesium.Cartesian3.fromDegrees(lng, lat, heightM)
    );
  }

  // ------------------------------------------------- projection & chrome

  onFrame(cb: () => void) {
    if (!this.isAlive()) return () => {};
    // postRender over `camera.changed`: under `requestRenderMode` a frame only happens when
    // something asked for one, so this fires exactly as often as the camera can have moved — and
    // `changed` would need a `percentageChanged` threshold tuned to be useful.
    const scene = this.viewer.scene;
    scene.postRender.addEventListener(cb);
    return () => {
      if (this.isAlive()) scene.postRender.removeEventListener(cb);
    };
  }

  canvas() {
    return this.isAlive() ? this.viewer.scene.canvas : null;
  }

  /** Scratch, reused per call. This runs per marker per frame; see the contract on `project`. */
  private readonly scratchAnchor = { value: null as Cartesian3 | null };
  private scratchWindow: import("cesium").Cartesian2 | null = null;
  private scratchNormal: Cartesian3 | null = null;
  private scratchToCamera: Cartesian3 | null = null;

  project(lat: number, lng: number, heightM: number, out: ScreenPoint): boolean {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return false;
    const scene = viewer.scene;
    const ellipsoid = scene.globe.ellipsoid;
    this.scratchWindow ??= new Cesium.Cartesian2();
    this.scratchNormal ??= new Cesium.Cartesian3();
    this.scratchToCamera ??= new Cesium.Cartesian3();
    this.scratchAnchor.value ??= new Cesium.Cartesian3();
    const anchor = Cesium.Cartesian3.fromDegrees(lng, lat, heightM, ellipsoid, this.scratchAnchor
      .value as Cartesian3);

    // Horizon check: the geodetic surface normal at the stop against the vector to the camera. A
    // positive dot product means the stop is on the near face of the globe. Without it, stops on
    // the far side project to plausible-looking screen coordinates and their cards smear across
    // the limb.
    ellipsoid.geodeticSurfaceNormal(anchor, this.scratchNormal);
    Cesium.Cartesian3.subtract(scene.camera.positionWC, anchor, this.scratchToCamera);
    if (Cesium.Cartesian3.dot(this.scratchNormal, this.scratchToCamera) <= 0) return false;

    // CSS pixel space. Deliberately not `worldToDrawingBufferCoordinates`, which is the same
    // transform in device pixels — GlobeBackground sets a custom `resolutionScale` and
    // `useBrowserRecommendedResolution: false`, so the two genuinely differ here. Returns
    // undefined behind the camera or near the ellipsoid centre.
    const projected = Cesium.SceneTransforms.worldToWindowCoordinates(
      scene,
      anchor,
      this.scratchWindow
    );
    if (!projected) return false;
    out.x = projected.x;
    out.y = projected.y;
    return true;
  }

  cameraDistanceM(lat: number, lng: number, heightM: number) {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return Number.POSITIVE_INFINITY;
    return Cesium.Cartesian3.distance(
      viewer.scene.camera.positionWC,
      Cesium.Cartesian3.fromDegrees(lng, lat, heightM)
    );
  }

  headingRad() {
    return this.isAlive() ? this.viewer.camera.heading : 0;
  }

  pitchRad() {
    return this.isAlive() ? this.viewer.camera.pitch : 0;
  }

  /**
   * The point the camera should pivot around: whatever is under the middle of the screen.
   *
   * Falls back down a chain because each stage can miss — `pickPosition` needs depth-texture
   * support, `pickEllipsoid` returns nothing when the boresight is aimed at sky, and the final
   * nadir fallback is the only one that can never fail.
   */
  private pickCentre(): Cartesian3 {
    const { Cesium } = this;
    const { scene, camera } = this.viewer;
    const mid = new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
    let point = scene.pickPositionSupported ? scene.pickPosition(mid) : undefined;
    if (!Cesium.defined(point)) point = camera.pickEllipsoid(mid, Cesium.Ellipsoid.WGS84);
    if (!Cesium.defined(point)) {
      const carto = camera.positionCartographic;
      point = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
    }
    return point;
  }

  /**
   * Re-aim the camera at a new pitch, heading and/or distance while keeping the same ground point
   * centred — the difference between "tilting the view" and "flying somewhere".
   */
  private pivot({
    pitchDeg,
    headingRad,
    rangeM,
    target,
    fly,
    durationS = 0.6,
    onSettled,
  }: {
    pitchDeg?: number;
    headingRad?: number;
    rangeM?: number;
    target?: Cartesian3;
    fly: boolean;
    durationS?: number;
    onSettled?: () => void;
  }) {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return;
    const pivotPoint = target ?? this.pickCentre();
    const offsetRange = rangeM ?? Cesium.Cartesian3.distance(viewer.camera.positionWC, pivotPoint);
    const pitch =
      pitchDeg === undefined
        ? viewer.camera.pitch
        : Cesium.Math.toRadians(Math.max(-89.9, Math.min(-1, pitchDeg)));
    const offset = new Cesium.HeadingPitchRange(
      headingRad === undefined ? viewer.camera.heading : headingRad,
      pitch,
      offsetRange
    );

    if (fly) {
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(pivotPoint, 0), {
        offset,
        duration: durationS,
        // Ease in *and* out, so a zoom step settles rather than stopping dead.
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        complete: onSettled,
        cancel: onSettled,
      });
      return;
    }
    viewer.camera.lookAtTransform(Cesium.Transforms.eastNorthUpToFixedFrame(pivotPoint), offset);
    // Releasing the transform is mandatory — leave it set and every subsequent drag pans in that
    // local frame forever instead of around the globe.
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }

  centreRangeM() {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return 0;
    return Cesium.Cartesian3.distance(viewer.camera.positionWC, this.pickCentre());
  }

  zoomStep({
    direction,
    ratio,
    minRangeM,
    maxRangeM,
    fromRangeM,
    durationS = 0.45,
    onSettled,
  }: ZoomStepOptions) {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return;
    const target = this.pickCentre();
    const distance = Cesium.Cartesian3.distance(viewer.camera.positionWC, target);
    // Successive presses step from the range the *previous* press was heading for, not from
    // wherever the camera happens to be mid-flight — each new flight cancels the last, so
    // measuring live would undershoot and rapid presses would stall instead of accelerating.
    const base = fromRangeM ?? distance;
    const wanted = base * (direction === 1 ? 1 - ratio : 1 + ratio);
    // Still clamped here rather than by screenSpaceCameraController: flyToBoundingSphere bypasses
    // that controller exactly as zoomIn/zoomOut did, so these bounds remain the only thing keeping
    // repeated presses out of the building mesh.
    const clamped = Math.min(Math.max(wanted, minRangeM), maxRangeM);
    if (Math.abs(distance - clamped) < 1) return;
    onSettled?.(clamped);
    this.pivot({
      rangeM: clamped,
      target,
      fly: true,
      durationS,
      onSettled: () => onSettled?.(null),
    });
  }

  setHeadingRad(headingRad: number, durationS = 0.6) {
    this.pivot({ headingRad, fly: true, durationS });
  }

  setPitchDeg(pitchDeg: number, options?: { animate?: boolean; durationS?: number }) {
    this.pivot({
      pitchDeg,
      fly: options?.animate ?? false,
      durationS: options?.durationS ?? 0.6,
    });
  }

  onMapClick(cb: (lat: number, lng: number) => void) {
    const { viewer, Cesium } = this;
    if (!this.isAlive()) return () => {};
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: { position: import("cesium").Cartesian2 }) => {
      const scene = viewer.scene;
      const picked = scene.pickPositionSupported ? scene.pickPosition(movement.position) : undefined;
      const point =
        picked ?? viewer.camera.pickEllipsoid(movement.position, Cesium.Ellipsoid.WGS84);
      if (!point) return;
      const carto = Cesium.Cartographic.fromCartesian(point);
      cb(Cesium.Math.toDegrees(carto.latitude), Cesium.Math.toDegrees(carto.longitude));
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return () => handler.destroy();
  }
}
