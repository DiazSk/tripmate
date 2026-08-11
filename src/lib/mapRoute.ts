import type { Cartesian3, Entity, Viewer } from "cesium";

/** Cesium is always reached through `await import("cesium")` — a static import pulls the whole
 *  library into the server bundle — so every function here takes the module as a parameter
 *  rather than importing it. */
type CesiumModule = typeof import("cesium");

/** `name` rides along for the HTML marker cards; the stop's index is its array position, so
 *  there is no id field and no change to `Stop` in types.ts. */
export interface RouteStop {
  lat: number;
  lng: number;
  name: string;
}

const colorCache = new Map<string, string>();

/**
 * Read a colour token off `:root`, so the globe's palette lives in globals.css beside the rest
 * of the design system instead of as string literals in here.
 *
 * Cached because `getComputedStyle` forces a style recalculation and this runs on every route
 * rebuild. Must be called from the client-only geometry path and never at module scope — this
 * module is reached during SSR, where there is no `document` (the same constraint that makes the
 * pin SVG in mapCamera use `encodeURIComponent` rather than `btoa`).
 *
 * Throws rather than falling back to a literal: a fallback would be a second copy of the value,
 * which is the exact thing moving these into CSS was meant to eliminate. A missing token means a
 * broken stylesheet, and this is the one place that can say which token.
 */
export function cssColor(name: string): string {
  let value = colorCache.get(name);
  if (value === undefined) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!value) throw new Error(`mapRoute: missing colour token ${name} — see globals.css :root`);
    colorCache.set(name, value);
  }
  return value;
}

/** Metres above the sampled surface to float the route. Small on purpose: enough to clear the
 *  road mesh without the line reading as detached when the camera drops to street level. */
const ROUTE_CLEARANCE_M = 2;
/** Opacity for route segments that fail the depth test, i.e. the parts running behind or through
 *  buildings. Dimmed rather than hidden so the whole day stays traceable at a low camera angle. */
const ROUTE_OCCLUDED_ALPHA = 0.3;

/**
 * How far above the route each stop's stem rises, in metres, and therefore where its HTML card
 * anchors. Exported because StopMarkerLayer has to resolve the same point in world space to put
 * the card on top of the stem — if these two ever disagree the card floats off its own stem.
 *
 * Fixed metres rather than a screen-space offset: the stem is a thing standing on the ground, so
 * it should grow and shrink with everything else as the camera moves. 150m clears Paris' ~35m
 * rooftops with room to spare, which is the point — the card has to sit above the skyline it is
 * labelling, not behind it.
 */
export const STEM_HEIGHT_M = 150;
const STEM_WIDTH = 4;
/** Low power keeps a bright thin core with a soft falloff; higher values wash the whole width out. */
const STEM_GLOW_POWER = 0.25;

/** Ground footprint under each stop. Two concentric discs at falling alpha — Cesium ellipses take
 *  a flat fill with no gradient, so a soft edge has to be faked by stacking. Drawn as circles, not
 *  oblong: at any pitch the app actually frames a route at, a ground circle already reads as an
 *  ellipse in perspective, and a real oblong would need an arbitrary rotation to point somewhere. */
const POOL_RADIUS_M = 42;
const POOL_OUTER_RATIO = 2.1;
const POOL_ALPHA = 0.22;
const POOL_OUTER_ALPHA = 0.09;

/** Points sampled along each arc. Enough that the curve reads as smooth at street level without
 *  turning a 30-day trip into tens of thousands of vertices. */
const ARC_SAMPLES = 96;
/** Arc apex as a fraction of the segment's ground length, so a cross-city hop arcs and a
 *  next-door step stays nearly flat, clamped at both ends. */
const ARC_LIFT_RATIO = 0.18;
const MIN_ARC_LIFT_M = 20;
const MAX_ARC_LIFT_M = 400;
/**
 * Segments shorter than this get no arc at all.
 *
 * Consecutive stops on one coordinate are normal rather than bad data — PREVIEW_TRIP's day 1
 * has the transfer, breakfast and shopping all at the same hotel — and a zero-length geodesic
 * has no unique path, so EllipsoidGeodesic would produce NaN positions and Cesium would draw
 * nothing while logging nothing. There is also no arc to see between a place and itself.
 */
const MIN_ARC_LENGTH_M = 5;

const ARC_GLOW_WIDTH = 9;
const ARC_GLOW_POWER = 0.2;
const ARC_GLOW_ALPHA = 0.5;
const ARC_DASH_WIDTH = 3;
const ARC_DASH_LENGTH = 18;
/** One full shimmer cycle. Slow on purpose — this is meant to read as a breath along the route,
 *  not a chase light. */
const SHIMMER_PERIOD_MS = 2600;
/** Fraction of a cycle each successive arc lags by, which is what makes the pulse appear to
 *  travel along the day rather than every arc breathing in unison. */
const SHIMMER_ARC_LAG = 0.16;
const SHIMMER_ALPHA_MIN = 0.5;
const SHIMMER_ALPHA_RANGE = 0.4;
/** Held alpha when the visitor has asked for reduced motion — mid-range, so the dashes read at
 *  the same weight they average to when animating. */
const SHIMMER_ALPHA_STATIC = 0.7;

/**
 * One altitude for the whole day's route, just above street level.
 *
 * `clampToHeightMostDetailed` samples the *tile surface*, and stops sit on buildings — Paris
 * came back 81-139m against ~35m of actual street. Probing the midpoints between consecutive
 * stops as well, then taking the minimum, biases the answer toward the ground: the gaps between
 * venues are usually road or open space. It's an approximation, not a true street elevation, but
 * a flat ribbon a few metres off is invisible at any framing the app actually uses.
 */
export async function sampleRouteAltitude(
  viewer: Viewer,
  Cesium: CesiumModule,
  groundPositions: Cartesian3[]
): Promise<number> {
  // Throws rather than returning undefined when the context lacks depth-texture support.
  if (!viewer.scene.clampToHeightSupported) return 0;

  const probes = [...groundPositions];
  for (let i = 1; i < groundPositions.length; i++) {
    probes.push(
      Cesium.Cartesian3.midpoint(
        groundPositions[i - 1],
        groundPositions[i],
        new Cesium.Cartesian3()
      )
    );
  }

  try {
    // Clones because clampToHeightMostDetailed mutates the array it is handed.
    const clamped = await viewer.scene.clampToHeightMostDetailed(probes.map((p) => p.clone()));
    if (viewer.isDestroyed()) return 0;
    const heights = clamped
      .filter((c): c is Cartesian3 => Cesium.defined(c))
      .map((c) => Cesium.Cartographic.fromCartesian(c).height)
      .filter((h) => Number.isFinite(h));
    if (heights.length === 0) return ROUTE_CLEARANCE_M;
    return Math.min(...heights) + ROUTE_CLEARANCE_M;
  } catch {
    // A sampling failure should cost the route its float, not its existence.
    return ROUTE_CLEARANCE_M;
  }
}

export interface RouteGeometry {
  /** Everything added to the entity collection, for the caller to remove wholesale. */
  entities: Entity[];
  /**
   * Tint one stop and the arcs touching it with the interface accent, or `null` to clear.
   *
   * This is the single deliberate exception to DESIGN.md's rule that interface colours stay off
   * the globe: amber here means "you are pointing at this", never "this is a Tuesday". Keep it
   * confined to interaction state.
   */
  setEmphasis: (index: number | null) => void;
  /**
   * Move every piece of this route to a new altitude.
   *
   * The reason this is a closure rather than the caller patching entities itself: the route is
   * drawn before its real altitude is known (see the comment at the `showDayRoute` call site),
   * so *every* piece of geometry has to be repositionable through one call. A new entity type
   * that forgets to handle itself here detaches from the rest at an oblique camera angle, and
   * that is the failure mode this whole module is shaped around.
   */
  reposition: (altitude: number) => void;
}

/**
 * The day's route as Cesium entities, floating at `altitude`.
 *
 * The line used to use `clampToGround`, which is not "drape on the ground" — it builds a
 * classification primitive that projects onto the Google 3D tile geometry, rooftops included, so
 * a straight hop across a block climbed every building in its path. Switching classificationType
 * can't help: CESIUM_3D_TILE is that same behaviour, and TERRAIN draws nothing at all here
 * because the classification shader reads back the globe depth texture and this app runs with
 * `globe.show = false`. So the line is unclamped and floats just above the surface instead.
 */
export function buildRouteGeometry(
  viewer: Viewer,
  Cesium: CesiumModule,
  stops: RouteStop[],
  altitude: number
): RouteGeometry {
  const positionsAt = (h: number) =>
    stops.map((s) => Cesium.Cartesian3.fromDegrees(s.lng, s.lat, h));
  const positions = positionsAt(altitude);
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const blue = Cesium.Color.fromCssColorString(cssColor("--route-blue"));

  // --- Arcs -------------------------------------------------------------------------------
  // One raised great-circle hop per consecutive pair, replacing the single flat cased line.
  // Precomputed once here and re-sampled by `reposition`, since the geodesic itself does not
  // depend on altitude — only the heights along it do.
  const scratchCarto = new Cesium.Cartographic();
  // `from`/`to` are kept so hover emphasis can find the arcs touching a given stop — segments
  // are not 1:1 with stop indices once degenerate hops are skipped.
  const segments: {
    geodesic: import("cesium").EllipsoidGeodesic;
    lift: number;
    from: number;
    to: number;
  }[] = [];
  for (let i = 1; i < stops.length; i++) {
    // Measured on the drawn positions rather than via the geodesic, because constructing a
    // geodesic is the thing being guarded against.
    if (Cesium.Cartesian3.distance(positions[i - 1], positions[i]) < MIN_ARC_LENGTH_M) continue;
    const geodesic = new Cesium.EllipsoidGeodesic(
      Cesium.Cartographic.fromDegrees(stops[i - 1].lng, stops[i - 1].lat),
      Cesium.Cartographic.fromDegrees(stops[i].lng, stops[i].lat),
      ellipsoid
    );
    const lift = Math.min(
      Math.max(geodesic.surfaceDistance * ARC_LIFT_RATIO, MIN_ARC_LIFT_M),
      MAX_ARC_LIFT_M
    );
    segments.push({ geodesic, lift, from: i - 1, to: i });
  }

  const accent = Cesium.Color.fromCssColorString(cssColor("--accent"));
  /** Which stop is currently hovered or selected, or null. Read live by the dash shimmer's
   *  callback, and written by `setEmphasis` below. */
  let emphasised: number | null = null;
  const isArcEmphasised = (index: number) =>
    emphasised !== null && (segments[index].from === emphasised || segments[index].to === emphasised);

  // Sine lift, so the arc leaves and meets the ground flat instead of kinking at its endpoints.
  const arcPositionsAt = (index: number, h: number) => {
    const { geodesic, lift } = segments[index];
    const out: import("cesium").Cartesian3[] = new Array(ARC_SAMPLES);
    for (let k = 0; k < ARC_SAMPLES; k++) {
      const t = k / (ARC_SAMPLES - 1);
      const point = geodesic.interpolateUsingFraction(t, scratchCarto);
      out[k] = Cesium.Cartesian3.fromRadians(
        point.longitude,
        point.latitude,
        h + lift * Math.sin(t * Math.PI),
        ellipsoid
      );
    }
    return out;
  };

  const startedAt = performance.now();
  // The blanket reduced-motion rule in globals.css reaches CSS only. This shimmer is driven from
  // performance.now() into a WebGL material, so it would pulse straight through the preference
  // unless it is checked here.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const arcs = segments.map((_, index) => {
    const arcPositions = arcPositionsAt(index, altitude);

    // Wide, soft, low-alpha base. This is what makes the route legible over busy photography;
    // the dashes alone disappear against a mid-grey rooftop.
    const glow = viewer.entities.add({
      polyline: {
        positions: arcPositions,
        width: ARC_GLOW_WIDTH,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: ARC_GLOW_POWER,
          color: blue.withAlpha(ARC_GLOW_ALPHA),
        }),
      },
    });

    const dash = viewer.entities.add({
      polyline: {
        positions: arcPositions,
        width: ARC_DASH_WIDTH,
        // NONE, not GEODESIC: these vertices already describe the curve, and asking Cesium to
        // re-trace a great circle between each adjacent pair would flatten the lift back out.
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineDashMaterialProperty({
          // Always a callback, even under reduced motion, so hover emphasis has one place to
          // take effect. Second argument false = "not constant", so Cesium re-evaluates every
          // frame; `withAlpha` into the supplied result keeps that allocation-free at ~160fps.
          color: new Cesium.CallbackProperty((_time, result) => {
            const base = isArcEmphasised(index) ? accent : blue;
            if (reduceMotion) {
              return base.withAlpha(SHIMMER_ALPHA_STATIC, result as import("cesium").Color);
            }
            const phase =
              (performance.now() - startedAt) / SHIMMER_PERIOD_MS - index * SHIMMER_ARC_LAG;
            const wave = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
            return base.withAlpha(
              SHIMMER_ALPHA_MIN + SHIMMER_ALPHA_RANGE * wave,
              result as import("cesium").Color
            );
          }, false),
          gapColor: Cesium.Color.TRANSPARENT,
          dashLength: ARC_DASH_LENGTH,
        }),
        // Stretches behind buildings draw dimmed rather than disappearing, so the whole day
        // stays traceable from a low angle. Only available unclamped.
        depthFailMaterial: new Cesium.ColorMaterialProperty(blue.withAlpha(ROUTE_OCCLUDED_ALPHA)),
      },
    });

    return { glow, dash };
  });

  const stemTopAt = (i: number, h: number) =>
    Cesium.Cartesian3.fromDegrees(stops[i].lng, stops[i].lat, h + STEM_HEIGHT_M);

  // A thin lit stem out of a pool of light on the ground, replacing the flat blue dot that used
  // to mark each stop. The dot had nowhere to put a name; this lifts the label clear of the
  // rooftops and gives the card something to stand on.
  //
  // arcType NONE is load-bearing: the default GEODESIC would try to trace a great circle between
  // two points that differ only in altitude, which is degenerate.
  const stems = stops.map((_, i) =>
    viewer.entities.add({
      polyline: {
        positions: [positions[i], stemTopAt(i, altitude)],
        width: STEM_WIDTH,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: STEM_GLOW_POWER,
          color: blue,
        }),
      },
    })
  );

  // Ellipse geometry takes its centre from `entity.position` but its altitude from `ellipse.height`
  // — the position's own height is ignored — so both have to be written here and in `reposition`.
  const pools = stops.map((_, i) =>
    (
      [
        [POOL_RADIUS_M, POOL_ALPHA],
        [POOL_RADIUS_M * POOL_OUTER_RATIO, POOL_OUTER_ALPHA],
      ] as const
    ).map(([radius, alpha]) =>
      viewer.entities.add({
        position: positions[i],
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          height: altitude,
          material: new Cesium.ColorMaterialProperty(blue.withAlpha(alpha)),
        },
      })
    )
  );

  // Recolouring closures rather than a loop over entities, so each piece keeps its own alpha —
  // emphasis must not flatten the pool's soft edge or the glow base's transparency into solid
  // amber. Colours are reassigned imperatively here rather than driven by CallbackProperties:
  // hover changes a few times a second, and making 16 ellipse materials non-constant would move
  // them into Cesium's dynamic batch and rebuild that geometry every frame.
  const tintPolyline =
    (entity: Entity, alpha: number) =>
    (base: import("cesium").Color) => {
      (entity.polyline!.material as import("cesium").PolylineGlowMaterialProperty).color =
        new Cesium.ConstantProperty(base.withAlpha(alpha));
    };
  const tintEllipse =
    (entity: Entity, alpha: number) =>
    (base: import("cesium").Color) => {
      (entity.ellipse!.material as import("cesium").ColorMaterialProperty).color =
        new Cesium.ConstantProperty(base.withAlpha(alpha));
    };

  const stemTints = stems.map((e) => tintPolyline(e, 1));
  const poolTints = pools.map((pair) => [
    tintEllipse(pair[0], POOL_ALPHA),
    tintEllipse(pair[1], POOL_OUTER_ALPHA),
  ]);
  const arcGlowTints = arcs.map((a) => tintPolyline(a.glow, ARC_GLOW_ALPHA));

  return {
    entities: [...arcs.flatMap((a) => [a.glow, a.dash]), ...stems, ...pools.flat()],
    setEmphasis: (index: number | null) => {
      if (index === emphasised) return;
      emphasised = index;
      stops.forEach((_, i) => {
        const base = i === index ? accent : blue;
        stemTints[i](base);
        poolTints[i].forEach((tint) => tint(base));
      });
      // The dashed line needs no write here — its callback reads `emphasised` directly.
      arcGlowTints.forEach((tint, k) => tint(isArcEmphasised(k) ? accent : blue));
    },
    reposition: (h: number) => {
      const corrected = positionsAt(h);
      // Both polylines of an arc share one freshly sampled array — they trace the same curve at
      // different widths, so re-sampling twice would only cost time.
      arcs.forEach(({ glow, dash }, index) => {
        const resampled = new Cesium.ConstantProperty(arcPositionsAt(index, h));
        glow.polyline!.positions = resampled;
        dash.polyline!.positions = resampled;
      });
      stems.forEach((e, i) => {
        e.polyline!.positions = new Cesium.ConstantProperty([corrected[i], stemTopAt(i, h)]);
      });
      pools.forEach((pair, i) =>
        pair.forEach((e) => {
          e.position = new Cesium.ConstantPositionProperty(corrected[i]);
          e.ellipse!.height = new Cesium.ConstantProperty(h);
        })
      );
    },
  };
}
