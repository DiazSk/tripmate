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
  const blue = Cesium.Color.fromCssColorString(cssColor("--route-blue"));
  const casing = Cesium.Color.fromCssColorString(cssColor("--route-casing"));

  // Apple's route styling: a solid stroke with a darker casing, no glow. The casing is
  // what keeps it legible over both pale pavement and dark water.
  const line = viewer.entities.add({
    polyline: {
      positions,
      width: 6,
      arcType: Cesium.ArcType.GEODESIC,
      material: new Cesium.PolylineOutlineMaterialProperty({
        color: blue,
        outlineColor: casing,
        outlineWidth: 2,
      }),
      // Segments running behind or through buildings draw dimmed rather than disappearing,
      // so the whole day stays traceable from a low angle. Only available unclamped — the
      // ground path returns its geometry before the depth-fail attribute is ever attached.
      depthFailMaterial: new Cesium.ColorMaterialProperty(
        blue.withAlpha(ROUTE_OCCLUDED_ALPHA)
      ),
    },
  });

  // Blue disc with a white ring at each stop, matching the reference's route pins. Placed at
  // the same altitude as the line — CLAMP_TO_GROUND would resolve against the hidden globe
  // (height 0) and visibly detach the dots from the line at an oblique angle.
  const dots = positions.map((position) =>
    viewer.entities.add({
      position,
      point: {
        pixelSize: 11,
        color: blue,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
  );

  return {
    entities: [line, ...dots],
    reposition: (h: number) => {
      const corrected = positionsAt(h);
      line.polyline!.positions = new Cesium.ConstantProperty(corrected);
      dots.forEach((e, i) => {
        e.position = new Cesium.ConstantPositionProperty(corrected[i]);
      });
    },
  };
}
