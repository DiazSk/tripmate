import type {
  FilterSpecification,
  LngLatLike,
  Map as MapLibreMap,
  Marker,
  StyleSpecification,
} from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";

import {
  arcLift,
  cssColor,
  DAY_STATE_ALPHA,
  dayPalette,
  DayVisualState,
  frameRouteBesidePanel,
  RouteStop,
  routeViewHeadingDeg,
  STEM_HEIGHT_M,
} from "@/lib/mapRoute";
import { centreHeightOffsetPx, metresBetween } from "@/lib/peekRange";
import { createArcTubeLayer, type ArcTube } from "@/lib/maplibreArcLayer";
import {
  CameraPose,
  CameraState,
  drawnDaysOf,
  FlyToPointOptions,
  FrameRouteOptions,
  HERO_VIEW,
  HIGHWAY_CASING,
  HIGHWAY_COLOR,
  MapRenderer,
  MIN_ROUTE_RADIUS_M,
  panelLeftEdgePx,
  ROUTE_FRAME_PITCH_DEG,
  RouteDrawRequest,
  ScreenPoint,
  SearchPin,
  STOP_MIN_RANGE_M,
  visibleMapWidthPx,
  ZoomStepOptions,
} from "@/lib/mapRenderer";

/**
 * Vector tiles, free and keyless — the same bar every other data source in this app clears (see
 * CLAUDE.md's "Data sources"). Liberty is OpenMapTiles' full-detail street style, which is what
 * carries the `building` layer the 3D extrusion below is built from.
 */
export const MAPLIBRE_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * Elevation, as a terrarium-encoded DEM from the AWS Open Data terrain-tiles bucket. Also keyless.
 *
 * This is what makes the MapLibre map *3D* rather than merely tilted: without a terrain source a
 * pitched view is a flat plane seen at an angle, and a mountain trip renders as if it were on a
 * table. Deliberately **not** satellite/photographic imagery — that is the one thing this engine
 * is not meant to reproduce.
 */
const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
/** Copied into `public/` by the postinstall step — see `scripts/copy-maplibre-assets.mjs`. */
export const MAPLIBRE_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
const DEM_SOURCE_ID = "tripmate-dem";
const DEM_MAX_ZOOM = 14;

const ROUTE_SOURCE_ID = "tripmate-route";
const STEM_SOURCE_ID = "tripmate-stems";
const HIGHWAY_SOURCE_ID = "tripmate-highways";
const CITY_SOURCE_ID = "tripmate-city";
const SEARCH_SOURCE_ID = "tripmate-search";
const BUILDINGS_LAYER_ID = "tripmate-buildings";

/**
 * MapLibre's zoom is defined against a 512px world tile, so this is the width of the whole world
 * in metres at the equator divided by that. Everything that converts between a camera *range* in
 * metres and a zoom level goes through it.
 */
const EQUATOR_M = 40_075_016.686;
const WORLD_TILE_PX = 512;

/** Pitch beyond MapLibre's default 60° cap. The tilt slider goes to 65° of MapLibre pitch (25 on
 *  its own scale), and the 2D/3D toggle wants the full range, so the cap is raised once at
 *  construction rather than clamped at every call site. */
const MAX_PITCH_DEG = 85;

/** Metres. Matches Cesium's `screenSpaceCameraController` bounds so both engines bottom out and
 *  top out in the same place — a GPU comparison at different altitudes compares nothing. */
const MIN_RANGE_M = 50;
const MAX_RANGE_M = 25_000_000;

/** Radius of a stem column, in metres. Cesium draws three nested cylinders 9m → 3.5m across; this
 *  is one extruded octagon at the middle of that, which is what a vector renderer can do
 *  cheaply. */
const STEM_RADIUS_M = 6;
const STEM_SIDES = 8;

/** Line widths in screen pixels for the *ground track* under each arc. */
const ROUTE_CORE_WIDTH_PX = 4;
const ROUTE_GLOW_WIDTH_PX = 14;
const ACTIVE_CORE_WIDTH_SCALE = 1.22;
const ACTIVE_GLOW_WIDTH_SCALE = 1.55;

const ARC_LAYER_ID = "tripmate-arcs";
/**
 * Points sampled along each arc's centreline.
 *
 * A free choice now, which it was not before. While the arcs were `fill-extrusion` prisms this was
 * pinned to the height each slab climbed — a prism cannot tilt, so a steep stretch became a tall
 * box and the only cure was more, shorter boxes. The tube is swept geometry: 48 samples is smooth
 * at any framing, and the cost is 48 rings of 8 vertices rather than 190 extruded quads.
 */
const ARC_SAMPLES = 48;
/**
 * Tube width on screen, in CSS pixels. The geometry is still world-space — it has to be, the tube
 * floats at stem height and is drawn by a depth-tested GL layer — but the radius is re-derived
 * from the camera on every zoom so the *rendered* width holds. This is what closes the last real
 * gap with Cesium, whose ribbon has always held a constant 16px whatever the camera did.
 *
 * It replaces a radius scaled off the hop's own ground length, which was backwards in the one case
 * that matters. That formula made the longest hops the fattest: this trip's 14.6km day-2 hop came
 * out 87.7m across and its 9.9km day-5 hop 59.6m, and a long hop is precisely the one you end up
 * zoomed into a slice of — so the arc you were nearest was always the widest wall on screen.
 *
 * Retuning those constants could not fix it, only move it. A tube narrow enough to be sane at
 * street level (~18m) is half a pixel across at the whole-trip framing; a tube visible at overview
 * is a wall up close. Only a camera-derived radius satisfies both ends, which is why this is a
 * pixel target rather than a smaller ratio.
 */
const ARC_WIDTH_PX = 13;
/** Floor and ceiling in metres, guarding the extremes of the zoom range rather than shaping the
 *  ordinary case: sub-metre geometry degenerates, and a kilometre-wide tube at world zoom is
 *  numerically pointless when the whole trip is four pixels wide anyway. */
const ARC_MIN_RADIUS_M = 3;
const ARC_MAX_RADIUS_M = 600;
/** Zoom the arc mesh was last built for. A rebuild is ~10k vertices, so it is coalesced to one per
 *  frame and skipped entirely below a delta the eye cannot resolve. */
const ARC_REBUILD_ZOOM_DELTA = 0.05;

/**
 * Cesium's day/night phases are a CSS blend sheet over the canvas and stay that way, so nothing
 * here needs to know about them. What *does* differ: the vector basemap ships light, and this app
 * is dark glass over dark imagery. `--map-basemap-tint` is laid over the tiles as a fill so the
 * ground reads as the same cool slate the photogrammetry was tinted to (`#9BA6B4` at 0.1 MIX).
 */
const BASEMAP_TINT_LAYER_ID = "tripmate-basemap-tint";

interface MapLibrePose {
  center: [number, number];
  zoom: number;
  bearing: number;
  /** MapLibre's own convention: 0 is nadir. */
  pitch: number;
}

type RouteProps = {
  kind: "route" | "stop";
  day: number;
  color: string;
  glow: string;
  opacity: number;
  glowOpacity: number;
  width: number;
  glowWidth: number;
  emphasised: boolean;
};

function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

/** Metres per pixel at a given zoom and latitude, on MapLibre's 512px world. */
function metresPerPixel(zoom: number, lat: number): number {
  return (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (WORLD_TILE_PX * 2 ** zoom);
}

/**
 * Move a lat/lng by a metre offset in the local east/north frame.
 *
 * Flat-earth arithmetic, which is exactly right at the scale this is used for (framing bias,
 * stem footprints — hundreds of metres, not hundreds of kilometres) and avoids pulling a geodesy
 * library in for it.
 */
function offsetMetres(lat: number, lng: number, eastM: number, northM: number): [number, number] {
  const dLat = northM / 111_320;
  const dLng = eastM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return [lng + dLng, lat + dLat];
}

/** Cesium pitch (negative down, -90 nadir) → MapLibre pitch (0 nadir, 85 near-horizon). */
function toMapLibrePitch(cesiumPitchDeg: number): number {
  return Math.max(0, Math.min(MAX_PITCH_DEG, 90 + cesiumPitchDeg));
}

/** The inverse, so the app's chrome keeps reading pitch in the one convention. */
function toCesiumPitchRad(mapLibrePitchDeg: number): number {
  return ((mapLibrePitchDeg - 90) * Math.PI) / 180;
}

/**
 * Build the style: OpenFreeMap Liberty, plus this app's own tint, terrain and extruded buildings.
 *
 * Fetched and patched rather than handed to the map as a URL, because three of the four things
 * added here have to be positioned *relative to layers the style already has* — the tint goes
 * above the landcover and below the roads, the buildings go under the labels — and a style
 * mutated after `load` flashes the untinted version for a frame first.
 */
async function buildStyle(): Promise<StyleSpecification | string> {
  let style: StyleSpecification;
  try {
    const res = await fetch(MAPLIBRE_STYLE_URL);
    if (!res.ok) throw new Error(`style ${res.status}`);
    style = (await res.json()) as StyleSpecification;
  } catch {
    // Fail-soft, the house convention: an unreachable style host should cost the map its
    // *styling*, not its existence. The URL form still boots and MapLibre will surface its own
    // error, which is strictly more informative than a blank container.
    return MAPLIBRE_STYLE_URL;
  }

  style.sources = {
    ...style.sources,
    [DEM_SOURCE_ID]: {
      type: "raster-dem",
      tiles: [DEM_TILES],
      tileSize: 256,
      maxzoom: DEM_MAX_ZOOM,
      encoding: "terrarium",
      attribution:
        '<a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> (AWS Open Data)',
    },
  };
  style.terrain = { source: DEM_SOURCE_ID, exaggeration: 1 };

  // **Labels in English.** OpenMapTiles ships every place name in its local script — Lisbon's
  // basemap comes back as `Lisboa`, Tokyo's in kana — and Liberty's own `text-field` asks for
  // `name:latin`, which transliterates rather than translates. The itinerary beside the map is in
  // English, so the map should be too. Rewritten here rather than after `load` because a style
  // mutated later flashes the local names for a frame first.
  //
  // `coalesce` and not a bare `name:en`: OSM has no English name for most minor streets, and a
  // missing key would blank the label entirely. English → transliterated latin → whatever the
  // local name is, which is strictly better than nothing.
  const englishName: unknown = [
    "coalesce",
    ["get", "name:en"],
    ["get", "name:latin"],
    ["get", "name"],
  ];
  for (const layer of style.layers) {
    if (layer.type !== "symbol") continue;
    const layout = (layer as { layout?: Record<string, unknown> }).layout;
    if (!layout || !("text-field" in layout)) continue;
    // Only the layers that actually name a place. A few symbol layers put a shield number or an
    // icon label in `text-field`, and rewriting those to a place name would be nonsense.
    if (!JSON.stringify(layout["text-field"]).includes("name")) continue;
    layout["text-field"] = englishName;
  }

  // Slate the basemap down to the tone the photogrammetry was tinted to. A `background`-style
  // fill over the land layers rather than a CSS filter on the canvas, because a CSS filter would
  // take the route ribbons and the buildings with it — the same trap Cesium's tileset tint
  // documents.
  const firstSymbol = style.layers.findIndex((l) => l.type === "symbol");
  const tintLayer = {
    id: BASEMAP_TINT_LAYER_ID,
    type: "background" as const,
    paint: {
      "background-color": "#12110f",
      "background-opacity": 0.34,
    },
  };

  // Extruded buildings, from the source layer Liberty already carries. Under the labels, so street
  // names still read over them.
  const openMapTilesSource = Object.entries(style.sources).find(
    ([, source]) => source.type === "vector"
  )?.[0];
  const buildingLayer = openMapTilesSource
    ? [
        {
          id: BUILDINGS_LAYER_ID,
          type: "fill-extrusion" as const,
          source: openMapTilesSource,
          "source-layer": "building",
          minzoom: 13,
          paint: {
            "fill-extrusion-color": "#7c8899",
            // `render_height` is OpenMapTiles' own field; the fallback keeps a footprint with no
            // height data from collapsing to nothing.
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-opacity": 0.72,
          } as never,
        },
      ]
    : [];

  const insertAt = firstSymbol < 0 ? style.layers.length : firstSymbol;
  style.layers = [
    ...style.layers.slice(0, insertAt),
    tintLayer,
    ...buildingLayer,
    ...style.layers.slice(insertAt),
  ];
  return style;
}

/**
 * Construct the map. Resolves once the style has loaded and the trip layers exist, which is the
 * moment the renderer is safe to hand to the provider — the same contract Cesium's tileset load
 * has.
 */
export async function createMapLibreMap(container: HTMLElement): Promise<MapLibreMap> {
  const { Map: MapLibreGlMap, setWorkerUrl } = await import("maplibre-gl");

  // Point the tile-parsing worker at a static copy, because the one MapLibre resolves for itself
  // does not survive this bundler. See `scripts/copy-maplibre-assets.mjs` for the full failure
  // mode — the short version is that the default is
  // `new URL("./maplibre-gl-worker.mjs", import.meta.url)`, Turbopack does not serve that path,
  // the module worker dies on its own import, and the map then renders a flat fill forever
  // without a single error anywhere.
  setWorkerUrl(MAPLIBRE_WORKER_URL);
  const style = await buildStyle();
  const map = new MapLibreGlMap({
    container,
    style,
    center: [HERO_VIEW.lng, HERO_VIEW.lat],
    zoom: rangeToZoomStatic(HERO_VIEW.heightM, HERO_VIEW.lat, container.clientHeight || 800),
    bearing: HERO_VIEW.headingDeg,
    pitch: toMapLibrePitch(HERO_VIEW.pitchDeg),
    maxPitch: MAX_PITCH_DEG,
    // The app draws its own compass, tilt slider and zoom buttons (`MapControls`), and its own
    // attribution slot — every default control here would be a second copy.
    attributionControl: false,
    // Matches Cesium's `useBrowserRecommendedResolution: false` + capped `resolutionScale`, so a
    // GPU comparison is not secretly a comparison of two different pixel counts.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
    // MapLibre's own name for "don't repaint when nothing changed". Cesium runs the equivalent
    // (`requestRenderMode`), and the glass panels' `backdrop-filter` re-blur on every map frame,
    // so this is the same load-bearing setting under a different name.
    refreshExpiredTiles: false,
    fadeDuration: 150,
  });

  // MapLibre reports style/tile trouble through an `error` *event*, not a rejection — with no
  // listener it is swallowed entirely. A DEM tile 404 or a bad paint expression would otherwise
  // leave a map that renders a basemap and silently never gets a route.
  map.on("error", (e) => console.error("[maplibre]", e?.error?.message ?? e));

  // `style.load`, and specifically not `load` or `isStyleLoaded()`.
  //
  // Both of the obvious choices deadlock here, and each cost a debugging session:
  //
  // - **`load`** means "style parsed AND every source in view settled AND the first frame
  //   painted". It never fired at all with a terrain DEM in the style.
  // - **`isStyleLoaded()`** stays `false` for as long as *any* source is still settling, and with
  //   `style.terrain` pointing at a DEM whose tiles stream continuously it never came back true —
  //   measured: `styledata` fired seven times in the first second, `isStyleLoaded()` false on
  //   every one of them, and the promise below never resolved. The map rendered a perfectly
  //   healthy basemap the whole time, which is what made it look like a route-drawing bug.
  //
  // `style.load` is the event that actually gates `addSource`/`addLayer`: the style is parsed and
  // mutable, whatever the tiles are doing. Guarded against having already fired, since the
  // listener is attached one statement after construction but the contract shouldn't depend on
  // that staying true.
  await new Promise<void>((resolve) => {
    if (map.style && map.isStyleLoaded()) {
      resolve();
      return;
    }
    map.once("style.load", () => resolve());
  });

  // Terrain has to be re-applied after load when the style came in as a URL fallback.
  if (!map.getSource(DEM_SOURCE_ID)) {
    map.addSource(DEM_SOURCE_ID, {
      type: "raster-dem",
      tiles: [DEM_TILES],
      tileSize: 256,
      maxzoom: DEM_MAX_ZOOM,
      encoding: "terrarium",
    });
  }
  if (!map.getTerrain()) map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: 1 });

  addTripLayers(map);
  return map;
}

/** Zoom for a camera-to-target distance, without a live transform to read the FOV off. */
function rangeToZoomStatic(rangeM: number, lat: number, viewHeightPx: number): number {
  // MapLibre's default vertical FOV is 36.87°, giving cameraToCenterDistance = 1.5 · height.
  const cameraToCentrePx = 1.5 * viewHeightPx;
  const mpp = rangeM / cameraToCentrePx;
  return Math.log2((EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (WORLD_TILE_PX * mpp));
}

/** The trip's own sources and layers, added once. Everything the app draws lives in these. */
function addTripLayers(map: MapLibreMap) {
  const isRoute: FilterSpecification = ["==", ["get", "kind"], "route"];
  const isStop: FilterSpecification = ["==", ["get", "kind"], "stop"];

  for (const id of [
    ROUTE_SOURCE_ID,
    STEM_SOURCE_ID,
    HIGHWAY_SOURCE_ID,
    CITY_SOURCE_ID,
    SEARCH_SOURCE_ID,
  ]) {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: emptyCollection() });
  }

  // Ambient city context first, so the trip's own route always sits over it.
  map.addLayer({
    id: `${HIGHWAY_SOURCE_ID}-casing`,
    type: "line",
    source: HIGHWAY_SOURCE_ID,
    paint: { "line-color": HIGHWAY_CASING, "line-width": 5, "line-opacity": 0.75 },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: HIGHWAY_SOURCE_ID,
    type: "line",
    source: HIGHWAY_SOURCE_ID,
    paint: { "line-color": HIGHWAY_COLOR, "line-width": 3 },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: CITY_SOURCE_ID,
    type: "line",
    source: CITY_SOURCE_ID,
    paint: { "line-color": cssColor("--city-boundary"), "line-width": 2, "line-opacity": 0.85 },
  });

  // The ground track: a blurred wide line under the arc, standing in for Cesium's
  // PolylineGlowMaterial *and* doing a job Cesium does not need — the arc floats hundreds of
  // metres up, so at a shallow pitch it can sit well away from the ground it belongs to, and this
  // is the shadow that ties it back down. Also the only thing left to read at nadir, where a
  // lifted ribbon collapses onto its own plan line.
  map.addLayer({
    id: `${ROUTE_SOURCE_ID}-glow`,
    type: "line",
    source: ROUTE_SOURCE_ID,
    filter: isRoute,
    paint: {
      "line-color": ["get", "glow"],
      "line-width": ["get", "glowWidth"],
      "line-opacity": ["*", ["get", "glowOpacity"], 0.55],
      "line-blur": 8,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: `${ROUTE_SOURCE_ID}-core`,
    type: "line",
    source: ROUTE_SOURCE_ID,
    filter: isRoute,
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["*", ["get", "width"], 0.5],
      "line-opacity": ["*", ["get", "opacity"], 0.5],
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });

  // **The parabolic arcs**, as real translucent tubes — see `maplibreArcLayer.ts` for why this is
  // a custom WebGL layer and not a style layer. Added last of the trip layers so it draws over the
  // ground track and the stop dots, the way a raised ribbon should.
  map.addLayer(createArcTubeLayer(ARC_LAYER_ID));

  // Search results, above everything the trip drew. A place the traveler is considering has to be
  // findable *while* the plan is on screen, so it sits over the ribbons rather than under them —
  // the opposite of the ordering every other overlay here uses, and deliberate.
  //
  // Amber, which DESIGN.md reserves for "you are pointing at this" and this app otherwise keeps
  // off the map. A search result is exactly that: a candidate under consideration, not part of the
  // plan. It stops being amber the moment it becomes a stop, because then it is a Tuesday.
  map.addLayer({
    id: `${SEARCH_SOURCE_ID}-halo`,
    type: "circle",
    source: SEARCH_SOURCE_ID,
    paint: {
      "circle-color": cssColor("--accent"),
      "circle-radius": ["case", ["get", "selected"], 20, 13],
      "circle-blur": 0.9,
      "circle-opacity": 0.7,
    },
  });
  map.addLayer({
    id: `${SEARCH_SOURCE_ID}-dot`,
    type: "circle",
    source: SEARCH_SOURCE_ID,
    paint: {
      "circle-color": cssColor("--accent"),
      "circle-radius": ["case", ["get", "selected"], 8, 5.5],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#12110f",
    },
  });
  map.addLayer({
    id: `${SEARCH_SOURCE_ID}-label`,
    type: "symbol",
    source: SEARCH_SOURCE_ID,
    layout: {
      "text-field": ["get", "name"],
      // Grows as the camera comes in, the same direction the reveal below runs. A label that is
      // fading in at a fixed size reads as a thing switching on; one that fades *and* grows reads
      // as a thing you are approaching.
      "text-size": ["interpolate", ["linear"], ["zoom"], 13.5, 10, 16, 16],
      "text-offset": [0, 1.2],
      "text-anchor": "top",
      "text-max-width": 9,
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: {
      "text-color": "#f7f5f2",
      "text-halo-color": "#12110f",
      "text-halo-width": 1.4,
      // The same rule the trip's own stop names follow, in the vocabulary a symbol layer speaks:
      // nothing at a distance, fading in as the ground comes up. 13.5 → 14.8 is the zoom band
      // that corresponds to `LABEL_HIDDEN_BEYOND_M` → `LABEL_VISIBLE_WITHIN_M` at this app's
      // viewport, so a searched café and a planned stop surface together rather than one before
      // the other.
      //
      // The pin the traveler picked from the list is exempt. They asked for that one by name, and
      // a selection that cannot be seen until you zoom to it is a selection that did nothing.
      //
      // **The `case` is inside the interpolation's outputs, not wrapped around it**, and it has to
      // be: MapLibre rejects `["zoom"]` anywhere but as the direct input of a top-level `step` or
      // `interpolate`, and the wrapped version — which reads more naturally — is a style error that
      // silently drops the whole property and leaves every label at full opacity. Caught by the
      // `error` listener in `createMapLibreMap`, which exists for exactly this.
      //
      // Reading it as written: at the far end a selected pin is 1 and an unselected one is 0; at
      // the near end both are 1. So selection is exempt by having the same value at both ends.
      "text-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        13.5,
        ["case", ["get", "selected"], 1, 0],
        14.8,
        1,
      ],
    },
  });

  // The ground pool under each stop, and its bright centre — Cesium's two nested ellipses.
  map.addLayer({
    id: `${ROUTE_SOURCE_ID}-pool`,
    type: "circle",
    source: ROUTE_SOURCE_ID,
    filter: isStop,
    paint: {
      "circle-color": ["get", "glow"],
      "circle-radius": 22,
      "circle-blur": 1,
      "circle-opacity": ["*", ["get", "glowOpacity"], 0.55],
    },
  });
  map.addLayer({
    id: `${ROUTE_SOURCE_ID}-dot`,
    type: "circle",
    source: ROUTE_SOURCE_ID,
    filter: isStop,
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": 5,
      "circle-opacity": ["get", "opacity"],
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#12110f",
      "circle-stroke-opacity": ["get", "opacity"],
    },
  });

  // The stems: real vertical volume, which is the one piece of Cesium's light-pillar the vector
  // renderer can reproduce honestly. An extruded octagon rather than a cylinder, at world scale,
  // so it fattens as the camera descends exactly as the beam did.
  //
  // 0.2, down from 0.55. Cesium's beam runs at BEAM_COLUMN_ALPHA 0.16 fading to ×0.35 at the top,
  // tapers 9m → 3.5m, and carries a 16px halo; this is a straight prism at one flat alpha with no
  // taper and no bloom, so at 0.55 the same day colour read as a solid plastic column here and as
  // a light beam there. Matching the alpha is most of closing that gap. It cannot close all of it:
  // `fill-extrusion` has no taper and no per-vertex gradient, so the remaining difference is
  // geometric and would mean moving the stem into the custom WebGL layer beside the arcs. Recorded
  // in docs/map-engine-gpu.md rather than left for the next person to notice from a screenshot.
  map.addLayer({
    id: STEM_SOURCE_ID,
    type: "fill-extrusion",
    source: STEM_SOURCE_ID,
    paint: {
      "fill-extrusion-color": ["get", "color"],
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.2,
    },
  });
}

/**
 * The `MapRenderer` over MapLibre GL JS.
 *
 * The deliberate differences from `CesiumRenderer`, all of them consequences of a vector renderer
 * having no true globe camera and no 3D-tile mesh to sample:
 *
 * - **Routes are draped, not arched.** Cesium lifts each hop onto a raised great circle so two
 *   trips over the same ground read as separate. Here they are lines on the terrain. Nothing above
 *   this file depends on the arc — `frameRoute` simply stops reserving room for apexes that don't
 *   exist.
 * - **Altitude is always 0.** `drawRoute` resolves 0 rather than a sampled surface height, because
 *   the geometry sits *on* the terrain rather than floating above an ellipsoid. `routeAltitudeRef`
 *   then makes the marker layer lift cards by `STEM_HEIGHT_M` alone, which is correct here.
 * - **No horizon cull.** A mercator map has no far side, so `project` rejects only what is behind
 *   the camera.
 * - **`centreHeightM` is honoured indirectly.** MapLibre aims at a point on the ground and cannot
 *   be asked to centre something 150m up — but it takes a pixel `offset` for where that ground
 *   point should land, and the screen displacement of a vertical column is computable from the
 *   pitch and the destination zoom. See `centreHeightOffsetPx`. This was previously dropped, which
 *   left the hover peek framing the road under a stop while the card naming it rode high in the
 *   frame, and on a tall anchor at a steep pitch, out of the clear area entirely.
 */
export class MapLibreRenderer implements MapRenderer {
  readonly engine = "maplibre" as const;

  private readonly map: MapLibreMap;
  private alive = true;
  private pin: Marker | null = null;
  private drawGeneration = 0;

  /** The last drawn trip, kept so a retint or an emphasis change can rebuild the GeoJSON. Vector
   *  features are cheap to regenerate — a week's trip is a few hundred coordinates — so this
   *  renderer re-serialises rather than reaching into live geometry the way Cesium does. */
  private days: RouteStop[][] = [];
  private soloFocus = false;
  private focusDay: number | null = null;
  private stateFor: (day: number) => DayVisualState = () => "baseline";
  private emphasis: { day: number; index: number } | null = null;

  /** Zoom the arc mesh currently on the GPU was built for, and the pending coalescing frame. */
  private arcZoom = Number.NaN;
  private arcFrame = 0;

  constructor(map: MapLibreMap) {
    this.map = map;
    map.once("remove", () => {
      this.alive = false;
    });
    // The arcs' radius is derived from the camera (see ARC_WIDTH_PX), so the mesh has to be
    // rebuilt as the camera moves or the width it was built for stops being true. `zoom` fires
    // per frame during a pinch, so this coalesces to one rebuild per frame and skips deltas below
    // what the eye resolves — a rebuild is a ~10k-vertex array fill, cheap but not free.
    map.on("zoom", () => {
      if (!this.isAlive() || this.days.length === 0) return;
      if (Math.abs(this.map.getZoom() - this.arcZoom) < ARC_REBUILD_ZOOM_DELTA) return;
      if (this.arcFrame) return;
      this.arcFrame = requestAnimationFrame(() => {
        this.arcFrame = 0;
        if (this.isAlive() && this.days.length) this.rebuildRoute();
      });
    });
  }

  isAlive() {
    return this.alive && !!this.map.getCanvas();
  }

  requestRender() {
    if (this.isAlive()) this.map.triggerRepaint();
  }

  // ---------------------------------------------------------------- overlays

  async drawRoute(request: RouteDrawRequest): Promise<number> {
    if (!this.isAlive()) return 0;
    this.drawGeneration++;
    this.days = request.days;
    this.soloFocus = request.soloFocus;
    this.focusDay = request.focusDay;
    this.stateFor = request.stateFor;
    this.emphasis = null;
    this.rebuildRoute();
    // Terrain-draped geometry has no float to sample. Zero is the honest answer and it is what
    // keeps the marker layer's lift correct — see the class comment.
    return 0;
  }

  clearRoute() {
    this.days = [];
    this.emphasis = null;
    this.setData(ROUTE_SOURCE_ID, emptyCollection());
    this.arcLayer()?.setArcs([]);
    this.setData(STEM_SOURCE_ID, emptyCollection());
  }

  applyDayStates(stateFor: (day: number) => DayVisualState) {
    this.stateFor = stateFor;
    this.rebuildRoute();
  }

  applyEmphasis(dayIndex: number | null, indexWithinDay: number | null) {
    const next =
      dayIndex === null || indexWithinDay === null ? null : { day: dayIndex, index: indexWithinDay };
    const same =
      (next === null && this.emphasis === null) ||
      (next !== null &&
        this.emphasis !== null &&
        next.day === this.emphasis.day &&
        next.index === this.emphasis.index);
    if (same) return;
    this.emphasis = next;
    this.rebuildRoute();
  }

  /**
   * Serialise the whole trip into the two GeoJSON sources.
   *
   * One pass builds both, because a stop's dot, its pool and its stem all read the same
   * day-state alpha and the same emphasis flag — splitting them across two builders is how they
   * would drift apart.
   */
  private rebuildRoute() {
    if (!this.isAlive() || this.days.length === 0) return;
    const accent = cssColor("--accent");
    const routeFeatures: Feature<LineString | Point, RouteProps>[] = [];
    const stemFeatures: Feature<Polygon, { color: string; height: number }>[] = [];
    const arcs: ArcTube[] = [];

    this.days.forEach((stops, day) => {
      if (this.soloFocus && this.focusDay !== null && day !== this.focusDay) return;
      if (stops.length === 0) return;
      const palette = dayPalette(day);
      const state = this.stateFor(day);
      const alpha = DAY_STATE_ALPHA[state];
      const active = state === "active";
      const color = cssColor(palette.core);
      const glow = cssColor(palette.glow);
      const base: Omit<RouteProps, "kind" | "emphasised"> = {
        day,
        color,
        glow,
        opacity: alpha,
        glowOpacity: alpha * 0.6,
        width: ROUTE_CORE_WIDTH_PX * (active ? ACTIVE_CORE_WIDTH_SCALE : 1),
        glowWidth: ROUTE_GLOW_WIDTH_PX * (active ? ACTIVE_GLOW_WIDTH_SCALE : 1),
      };

      if (stops.length > 1) {
        routeFeatures.push({
          type: "Feature",
          properties: { ...base, kind: "route", emphasised: false },
          geometry: {
            type: "LineString",
            coordinates: stops.map((s) => [s.lng, s.lat]),
          },
        });
        for (let i = 1; i < stops.length; i++) {
          // An arc touching the stop being pointed at takes the accent, exactly as Cesium's does —
          // amber means "you are pointing at this", never "this is a Tuesday".
          const touchesEmphasis =
            this.emphasis?.day === day &&
            (this.emphasis.index === i - 1 || this.emphasis.index === i);
          const arc = buildArcTube(
            stops[i - 1],
            stops[i],
            touchesEmphasis ? accent : color,
            touchesEmphasis ? 1 : alpha,
            active,
            (lat, lng) => this.groundElevationM(lat, lng),
            metresPerPixel(this.map.getZoom(), this.map.getCenter().lat)
          );
          if (arc) arcs.push(arc);
        }
      }

      stops.forEach((stop, index) => {
        // Amber means "you are pointing at this", never "this is a Tuesday" — the single
        // deliberate exception to keeping interface colours off the map. See `RouteGeometry`.
        const emphasised = this.emphasis?.day === day && this.emphasis.index === index;
        routeFeatures.push({
          type: "Feature",
          properties: {
            ...base,
            kind: "stop",
            emphasised,
            color: emphasised ? accent : color,
            glow: emphasised ? accent : glow,
            opacity: emphasised ? 1 : alpha,
            glowOpacity: emphasised ? 0.9 : alpha * 0.6,
          },
          geometry: { type: "Point", coordinates: [stop.lng, stop.lat] },
        });
        stemFeatures.push({
          type: "Feature",
          properties: {
            color: emphasised ? accent : color,
            height: STEM_HEIGHT_M,
          },
          geometry: {
            type: "Polygon",
            coordinates: [circleRing(stop.lat, stop.lng, STEM_RADIUS_M)],
          },
        });
      });
    });

    this.setData(ROUTE_SOURCE_ID, { type: "FeatureCollection", features: routeFeatures });
    this.arcZoom = this.map.getZoom();
    this.arcLayer()?.setArcs(arcs);
    this.setData(STEM_SOURCE_ID, { type: "FeatureCollection", features: stemFeatures });
  }

  setPin(pin: { lat: number; lng: number; label?: string } | null) {
    if (!this.isAlive()) return;
    this.pin?.remove();
    this.pin = null;
    if (!pin?.label) return;
    void import("maplibre-gl").then(({ Marker: MapLibreMarker }) => {
      if (!this.isAlive()) return;
      // A DOM marker rather than a symbol layer: the pin is one element that never needs
      // collision detection, and this way it carries the same SVG the Cesium billboard does
      // without a sprite round-trip.
      const el = document.createElement("div");
      el.className = "tripmate-map-pin";
      el.innerHTML = `<img src="${PIN_DATA_URI}" width="24" height="32" alt="" /><span>${escapeHtml(
        pin.label ?? ""
      )}</span>`;
      this.pin = new MapLibreMarker({ element: el, anchor: "bottom" })
        .setLngLat([pin.lng, pin.lat])
        .addTo(this.map);
    });
  }

  drawHighways(segments: { points: { lat: number; lng: number }[] }[]) {
    this.setData(HIGHWAY_SOURCE_ID, {
      type: "FeatureCollection",
      features: segments.map((segment) => ({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: segment.points.map((p) => [p.lng, p.lat]),
        },
      })),
    });
  }

  drawCityBoundary(segments: { lat: number; lng: number }[][]) {
    // Outline only, never a fill — a translucent polygon over the map hides the city it is
    // describing, which is the one thing this must not do.
    this.setData(CITY_SOURCE_ID, {
      type: "FeatureCollection",
      features: segments.map((segment) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: segment.map((p) => [p.lng, p.lat]) },
      })),
    });
  }

  showSearchResults(places: SearchPin[]) {
    this.setData(SEARCH_SOURCE_ID, {
      type: "FeatureCollection",
      features: places.map((place) => ({
        type: "Feature",
        // `id` on the feature as well as in the properties: MapLibre needs it for feature state
        // if this ever grows hover styling, and the properties are what the paint expressions read.
        properties: { id: place.id, name: place.name, selected: !!place.selected },
        geometry: { type: "Point", coordinates: [place.lng, place.lat] },
      })),
    });
  }

  clearOverlays() {
    this.drawGeneration++;
    this.clearRoute();
    this.setData(HIGHWAY_SOURCE_ID, emptyCollection());
    this.setData(CITY_SOURCE_ID, emptyCollection());
    this.setData(SEARCH_SOURCE_ID, emptyCollection());
    this.setPin(null);
  }

  /** The custom tube layer, once the style has it. Looked up rather than held, because a style
   *  reload would replace the instance under us. */
  private arcLayer(): { setArcs: (arcs: ArcTube[]) => void } | null {
    if (!this.isAlive()) return null;
    const layer = this.map.getLayer(ARC_LAYER_ID) as unknown as
      | { implementation?: { setArcs?: (arcs: ArcTube[]) => void } }
      | undefined;
    const impl = layer?.implementation;
    return impl?.setArcs ? (impl as { setArcs: (arcs: ArcTube[]) => void }) : null;
  }

  /**
   * Ground height under a point, in metres above sea level.
   *
   * The arcs are drawn at absolute altitude, so a trip through a hill town needs the hill or the
   * whole ribbon sinks into it. Null before the DEM tiles covering that point have loaded, which is
   * the ordinary case for the first draw — zero is the right answer then, and the next redraw (a
   * day change, a hover) picks up the real elevation.
   */
  private groundElevationM(lat: number, lng: number): number {
    if (!this.isAlive() || !this.map.getTerrain()) return 0;
    return this.map.queryTerrainElevation([lng, lat]) ?? 0;
  }

  private setData(id: string, data: FeatureCollection) {
    if (!this.isAlive()) return;
    const source = this.map.getSource(id);
    if (source && "setData" in source) {
      (source as { setData: (d: FeatureCollection) => void }).setData(data);
    }
  }

  // ---------------------------------------------------------------- camera


  /**
   * The three numbers every camera conversion here needs, derived from public getters only.
   *
   * `map.transform` carries all of them and is *not* public API — reaching into it would tie this
   * file to MapLibre's internals for arithmetic that is three lines. The camera-to-centre distance
   * is fixed by the vertical FOV and the viewport height (MapLibre's own definition), and metres
   * per pixel follows from the zoom and the centre latitude.
   */
  private viewSizePx() {
    const canvas = this.map.getCanvas();
    return { width: canvas?.clientWidth ?? 0, height: canvas?.clientHeight ?? 0 };
  }

  private fovRad() {
    return (this.map.getVerticalFieldOfView() * Math.PI) / 180;
  }

  /** Camera-to-centre distance in *pixels* — MapLibre's `cameraToCenterDistance`, recomputed. */
  private cameraToCentrePx() {
    return (0.5 / Math.tan(this.fovRad() / 2)) * Math.max(1, this.viewSizePx().height);
  }

  /** Camera-to-target distance in metres → zoom, using the live viewport and FOV. */
  private rangeToZoom(rangeM: number, lat: number): number {
    const mpp = Math.max(1e-6, rangeM / this.cameraToCentrePx());
    const zoom = Math.log2(
      (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (WORLD_TILE_PX * mpp)
    );
    return Math.max(this.map.getMinZoom(), Math.min(this.map.getMaxZoom(), zoom));
  }

  /** The current camera-to-screen-centre distance in metres. */
  centreRangeM(): number {
    if (!this.isAlive()) return 0;
    return this.cameraToCentrePx() * metresPerPixel(this.map.getZoom(), this.map.getCenter().lat);
  }

  flyToPoint(options: FlyToPointOptions) {
    if (!this.isAlive()) return;
    const padding = this.panelPadding();
    const bearing = ((options.headingRad ?? 0) * 180) / Math.PI;
    const pitch = toMapLibrePitch(options.pitchDeg);

    // --- The neighbourhood framing: a box around the stop, not a dive onto it.
    if (options.contextRadiusM) {
      const [west, south] = offsetMetres(
        options.lat,
        options.lng,
        -options.contextRadiusM,
        -options.contextRadiusM
      );
      const [east, north] = offsetMetres(
        options.lat,
        options.lng,
        options.contextRadiusM,
        options.contextRadiusM
      );
      // `fitBounds` and not a computed zoom, because the two answer different questions. A zoom is
      // "how far back"; bounds are "keep this much ground in the clear part of the frame", and the
      // clear part is what the padding below describes. The `maxZoom` cap is what actually stops
      // the over-zoom: a small box in a large viewport would otherwise fit at street level again.
      const bounds: [[number, number], [number, number]] = [
        [west, south],
        [east, north],
      ];
      const fitZoom = this.zoomForRange(options.minRangeM ?? STOP_MIN_RANGE_M, options.lat);
      // The same lift the plain flight applies, but the zoom has to be asked for rather than
      // computed: `fitBounds` picks its own, and the offset is only right at the zoom actually
      // landed on. `cameraForBounds` runs the same solve without moving the camera.
      const fitted = this.map.cameraForBounds(bounds, { padding, maxZoom: fitZoom, bearing, pitch });
      const fitOffset = centreHeightOffsetPx(
        options.centreHeightM ?? 0,
        fitted?.zoom ?? fitZoom,
        options.lat,
        pitch,
        this.viewSizePx().height
      );
      this.map.fitBounds(
        bounds,
        {
          padding,
          maxZoom: fitZoom,
          bearing,
          pitch,
      // Spread conditionally, never `offset: <maybe undefined>`. MapLibre distinguishes an absent
      // `offset` key from one present and undefined: it runs `Point.convert(options.offset)` and
      // reads `.x` off the result, so an explicit `undefined` throws
      // `TypeError: Cannot read properties of undefined (reading 'x')` out of `flyTo`/`fitBounds`
      // — measured in a browser, where `offset: undefined` threw while an absent key and a real
      // `[0, 40]` pair both succeeded. `centreHeightOffsetPx` returns `undefined` by design for
      // "nothing to lift" (peekRange.test.mjs asserts exactly that), which is every destination
      // flight, since those pass `centreHeightM = 0`. Passing it straight through made the throw
      // escape `flyToPoint`, and the provider's queued first-build flight was dropped with it:
      // the camera sat on HERO_VIEW over the Sahara for the whole generation while the band read
      // "PLANNING ROME". Stop flights were unaffected — a card height is > 0, so they got a real
      // pair — which is what made this look like a route-drawing bug rather than a camera one.
          ...(fitOffset ? { offset: fitOffset } : {}),
          // `linear: true` picks `easeTo` over `flyTo`. `flyTo` flies the van Wijk arc — it pulls
          // out to altitude and descends again, which over a few hundred metres of ground reads as
          // the map lurching away and coming back. A monotone ease across the same short distance
          // is the glide this wants.
          linear: true,
          easing: cubicInOut,
          duration: (options.durationS ?? 1.2) * 1000,
          essential: true,
        }
      );
      return;
    }

    // --- Everything else: a destination flight, or the hover peek's own computed lean.
    const rangeM = Math.max(
      MIN_RANGE_M,
      Math.min(MAX_RANGE_M, Math.max(options.rangeM, options.minRangeM ?? 0))
    );
    const zoom = this.rangeToZoom(rangeM, options.lat);
    // Honour `centreHeightM` rather than dropping it. The caller aims at the stop's floating
    // card, not the ground under it, and on this engine that is the difference between the peek
    // framing the thing that names the place and framing a patch of road with the label riding
    // off the top of the clear area.
    const flyOffset = centreHeightOffsetPx(
      options.centreHeightM ?? 0,
      zoom,
      options.lat,
      pitch,
      this.viewSizePx().height
    );
    this.map.flyTo({
      center: [options.lng, options.lat],
      zoom,
      pitch,
      bearing,
      padding,
    // Spread conditionally, never `offset: <maybe undefined>`. MapLibre distinguishes an absent
    // `offset` key from one present and undefined: it runs `Point.convert(options.offset)` and
    // reads `.x` off the result, so an explicit `undefined` throws
    // `TypeError: Cannot read properties of undefined (reading 'x')` out of `flyTo`/`fitBounds`
    // — measured in a browser, where `offset: undefined` threw while an absent key and a real
    // `[0, 40]` pair both succeeded. `centreHeightOffsetPx` returns `undefined` by design for
    // "nothing to lift" (peekRange.test.mjs asserts exactly that), which is every destination
    // flight, since those pass `centreHeightM = 0`. Passing it straight through made the throw
    // escape `flyToPoint`, and the provider's queued first-build flight was dropped with it:
    // the camera sat on HERO_VIEW over the Sahara for the whole generation while the band read
    // "PLANNING ROME". Stop flights were unaffected — a card height is > 0, so they got a real
    // pair — which is what made this look like a route-drawing bug rather than a camera one.
      ...(flyOffset ? { offset: flyOffset } : {}),
      duration: (options.durationS ?? 2.5) * 1000,
      essential: true,
    });
  }

  /**
   * The clear part of the map, as MapLibre padding.
   *
   * Centre the stop in the strip the itinerary leaves, not in the window. Dead centre of a 1440px
   * window is 720px in — well inside the 40%-wide panel — so hovering a row used to fly the camera
   * to a point that landed *behind* the plan you were reading.
   *
   * The right inset is **measured** off the panel's own box rather than hardcoded, so Focus Mode's
   * wider 62% split and the collapsed capsule are both handled without this knowing about either;
   * collapsed, it falls back to the same inset as the left and the framing is symmetric again.
   *
   * The top inset is the largest of the four and that is not arbitrary: a stop's marker card is
   * drawn a full card-height *above* its anchor (`translate(-50%, -100%)`) and a day badge floats
   * `DAY_LABEL_LIFT_M` higher still, so a stop framed flush against the top edge has its own label
   * off-screen — the one piece of the map that names it.
   */
  private panelPadding() {
    const { width } = this.viewSizePx();
    const panelInset = Math.max(0, width - visibleMapWidthPx(width));
    return {
      top: 120,
      bottom: 80,
      left: 80,
      right: Math.max(80, panelInset),
    };
  }

  /** The zoom at which the camera sits `rangeM` from the ground — `rangeToZoom`'s public shape. */
  private zoomForRange(rangeM: number, lat: number) {
    return this.rangeToZoom(Math.max(MIN_RANGE_M, Math.min(MAX_RANGE_M, rangeM)), lat);
  }

  frameRoute({ days, focusDay, panelVisible, durationS }: FrameRouteOptions) {
    if (!this.isAlive()) return;
    const drawnStops = drawnDaysOf(days, focusDay).flat();
    if (drawnStops.length === 0) return;

    // The centroid and the radius that contains every stop — the flat-map equivalent of Cesium's
    // `BoundingSphere.fromPoints`. No arc-apex reservation: the routes are draped, so there are no
    // apexes to keep in frame.
    const centreLat = drawnStops.reduce((sum, s) => sum + s.lat, 0) / drawnStops.length;
    const centreLng = drawnStops.reduce((sum, s) => sum + s.lng, 0) / drawnStops.length;
    const radius = Math.max(
      MIN_ROUTE_RADIUS_M,
      ...drawnStops.map((s) => metresBetween({ lat: centreLat, lng: centreLng }, s))
    );

    // The same framing rule Cesium uses, from the same pure function: pull back so the route fills
    // the strip the panel leaves, then shift the aim point so it lands in that strip.
    const { width: viewWidth, height: viewHeight } = this.viewSizePx();
    const tanHalfFovX = Math.tan(this.fovRad() / 2) * (viewWidth / Math.max(1, viewHeight));
    const { biasM, rangeM } = frameRouteBesidePanel(
      radius,
      viewWidth,
      panelLeftEdgePx(panelVisible, viewWidth),
      tanHalfFovX
    );

    // Face the route across its long axis rather than down it — see `routeViewHeadingDeg`.
    const headingDeg = routeViewHeadingDeg(drawnStops);
    const heading = (headingDeg * Math.PI) / 180;
    // Screen-right in the local frame is (cos h, -sin h) over (east, north). Identical to the
    // Cesium path's ENU derivation, minus the matrix work a sphere needs.
    const centre = offsetMetres(
      centreLat,
      centreLng,
      biasM * Math.cos(heading),
      -biasM * Math.sin(heading)
    );

    this.map.flyTo({
      center: centre as LngLatLike,
      zoom: this.rangeToZoom(Math.max(MIN_RANGE_M, rangeM), centreLat),
      bearing: headingDeg,
      pitch: toMapLibrePitch(ROUTE_FRAME_PITCH_DEG),
      // Explicitly zero, not omitted. `flyTo` *retains* whatever padding the last camera command
      // set, so a stop flight's right-padding would otherwise still be in force here and compound
      // with the metre bias this function already applied — biasing the route twice.
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      duration: (durationS ?? 2.0) * 1000,
      essential: true,
    });
  }

  flyHome(durationS = 2.0) {
    if (!this.isAlive()) return;
    this.map.flyTo({
      center: [HERO_VIEW.lng, HERO_VIEW.lat],
      zoom: this.rangeToZoom(HERO_VIEW.heightM, HERO_VIEW.lat),
      bearing: HERO_VIEW.headingDeg,
      pitch: toMapLibrePitch(HERO_VIEW.pitchDeg),
      duration: durationS * 1000,
      essential: true,
    });
  }

  cameraState(): CameraState | null {
    if (!this.isAlive()) return null;
    const centre = this.map.getCenter();
    return {
      lat: centre.lat,
      lng: centre.lng,
      rangeM: this.centreRangeM(),
      headingRad: (this.map.getBearing() * Math.PI) / 180,
      pitchDeg: (toCesiumPitchRad(this.map.getPitch()) * 180) / Math.PI,
    };
  }

  restoreCamera(state: CameraState) {
    if (!this.isAlive()) return;
    this.map.jumpTo({
      center: [state.lng, state.lat],
      zoom: this.rangeToZoom(
        Math.max(MIN_RANGE_M, Math.min(MAX_RANGE_M, state.rangeM)),
        state.lat
      ),
      bearing: (state.headingRad * 180) / Math.PI,
      pitch: toMapLibrePitch(state.pitchDeg),
      // Cleared, for the same reason `frameRoute` clears it: padding persists across camera
      // commands, and a stop flight's right-padding still in force here would slide the restored
      // view sideways — which is precisely the drift this handoff exists to avoid.
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  }

  capturePose(): CameraPose | null {
    if (!this.isAlive()) return null;
    const c = this.map.getCenter();
    return {
      center: [c.lng, c.lat],
      zoom: this.map.getZoom(),
      bearing: this.map.getBearing(),
      pitch: this.map.getPitch(),
    } satisfies MapLibrePose;
  }

  flyToPose(pose: CameraPose, durationS: number, onArrive?: () => void) {
    if (!this.isAlive()) return;
    const p = pose as MapLibrePose;
    if (onArrive) this.map.once("moveend", onArrive);
    this.map.flyTo({
      center: p.center,
      zoom: p.zoom,
      bearing: p.bearing,
      pitch: p.pitch,
      duration: durationS * 1000,
      essential: true,
    });
  }

  poseHeadingRad(pose: CameraPose) {
    return ((pose as MapLibrePose).bearing * Math.PI) / 180;
  }

  posePitchRad(pose: CameraPose) {
    return toCesiumPitchRad((pose as MapLibrePose).pitch);
  }

  distanceFromPoseM(pose: CameraPose, lat: number, lng: number, heightM: number) {
    const p = pose as MapLibrePose;
    const rangeM = this.cameraToCentrePx() * metresPerPixel(p.zoom, p.center[1]);
    return this.distanceFromCamera(p.center, rangeM, p.bearing, p.pitch, lat, lng, heightM);
  }

  /**
   * Where the camera actually is, and how far that is from a world point.
   *
   * MapLibre has no "camera position" getter, so it is reconstructed: the camera sits `rangeM`
   * from the centre point, tilted back by the pitch and behind the bearing. Good to the metre at
   * every framing this app uses, and the only alternative is reaching into the transform's
   * internal matrices.
   */
  private distanceFromCamera(
    centre: [number, number],
    rangeM: number,
    bearingDeg: number,
    pitchDeg: number,
    lat: number,
    lng: number,
    heightM: number
  ) {
    const pitchRad = (pitchDeg * Math.PI) / 180;
    const bearingRad = (bearingDeg * Math.PI) / 180;
    const groundBack = rangeM * Math.sin(pitchRad);
    const altitude = rangeM * Math.cos(pitchRad);
    // Opposite the bearing: the camera is *behind* the centre point.
    const [camLng, camLat] = offsetMetres(
      centre[1],
      centre[0],
      -groundBack * Math.sin(bearingRad),
      -groundBack * Math.cos(bearingRad)
    );
    const horizontal = metresBetween({ lat: camLat, lng: camLng }, { lat, lng });
    const vertical = altitude - heightM;
    return Math.hypot(horizontal, vertical);
  }

  // ------------------------------------------------- projection & chrome

  onFrame(cb: () => void) {
    if (!this.isAlive()) return () => {};
    this.map.on("render", cb);
    return () => {
      if (this.isAlive()) this.map.off("render", cb);
    };
  }

  canvas() {
    return this.isAlive() ? this.map.getCanvas() : null;
  }

  project(lat: number, lng: number, heightM: number, out: ScreenPoint): boolean {
    if (!this.isAlive()) return false;
    const p = this.map.project([lng, lat]);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;

    // Screen lift for an object `heightM` above the ground. At nadir a vertical column projects
    // to nothing; at the horizon it projects to its full height. `sin(pitch)` is that factor, and
    // `pixelsPerMeter` converts once at the centre latitude — perspective foreshortening across
    // the frame is a sub-pixel effect at every framing this app uses.
    const pixelsPerMetre = 1 / metresPerPixel(this.map.getZoom(), this.map.getCenter().lat);
    out.x = p.x;
    out.y = p.y - heightM * pixelsPerMetre * Math.sin((this.map.getPitch() * Math.PI) / 180);

    // No horizon cull — a mercator map has no far side. What it does have is everything *beyond*
    // the horizon line at a steep pitch, which MapLibre projects to coordinates above the top of
    // the frame; the caller's own off-screen margin rejects those.
    return true;
  }

  cameraDistanceM(lat: number, lng: number, heightM: number) {
    if (!this.isAlive()) return Number.POSITIVE_INFINITY;
    const c = this.map.getCenter();
    return this.distanceFromCamera(
      [c.lng, c.lat],
      this.centreRangeM(),
      this.map.getBearing(),
      this.map.getPitch(),
      lat,
      lng,
      heightM
    );
  }

  headingRad() {
    return this.isAlive() ? (this.map.getBearing() * Math.PI) / 180 : 0;
  }

  pitchRad() {
    return this.isAlive() ? toCesiumPitchRad(this.map.getPitch()) : 0;
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
    if (!this.isAlive()) return;
    const distance = this.centreRangeM();
    // Successive presses step from the range the *previous* press was heading for, not from
    // wherever the camera happens to be mid-flight.
    const base = fromRangeM ?? distance;
    const wanted = base * (direction === 1 ? 1 - ratio : 1 + ratio);
    const clamped = Math.min(Math.max(wanted, minRangeM), maxRangeM);
    if (Math.abs(distance - clamped) < 1) return;
    onSettled?.(clamped);
    const centre = this.map.getCenter();
    this.map.once("moveend", () => onSettled?.(null));
    this.map.easeTo({
      zoom: this.rangeToZoom(clamped, centre.lat),
      duration: durationS * 1000,
      essential: true,
    });
  }

  setHeadingRad(headingRad: number, durationS = 0.6) {
    if (!this.isAlive()) return;
    this.map.easeTo({
      bearing: (headingRad * 180) / Math.PI,
      duration: durationS * 1000,
      essential: true,
    });
  }

  setPitchDeg(pitchDeg: number, options?: { animate?: boolean; durationS?: number }) {
    if (!this.isAlive()) return;
    const pitch = toMapLibrePitch(pitchDeg);
    if (options?.animate) {
      this.map.easeTo({ pitch, duration: (options.durationS ?? 0.6) * 1000, essential: true });
      return;
    }
    this.map.jumpTo({ pitch });
  }

  onMapClick(cb: (lat: number, lng: number) => void) {
    if (!this.isAlive()) return () => {};
    const handler = (e: { lngLat: { lat: number; lng: number } }) => cb(e.lngLat.lat, e.lngLat.lng);
    this.map.on("click", handler);
    return () => {
      if (this.isAlive()) this.map.off("click", handler);
    };
  }
}

/**
 * One hop as a chain of floating slabs — the MapLibre stand-in for Cesium's raised great circle.
 *
 * The height profile is `STEM_HEIGHT_M + arcLift(distance) · sin(πt)`, character for character the
 * one `buildRouteGeometry` uses, so a trip drawn on either engine arches by the same amount. What
 * differs is only how it is realised: Cesium can put a polyline at an altitude, MapLibre cannot, so
 * each segment becomes a rectangle extruded between `base` and `height`.
 *
 * The slabs are deliberately *thicker* than the height they climb per segment (`ARC_THICKNESS_M`
 * against a few metres of rise), so consecutive ones overlap and the chain reads as one continuous
 * ribbon rather than a staircase.
 */
function buildArcTube(
  from: RouteStop,
  to: RouteStop,
  color: string,
  alpha: number,
  active: boolean,
  groundAt: (lat: number, lng: number) => number,
  metresPerPx: number
): ArcTube | null {
  const distanceM = metresBetween(from, to);
  // Same floor Cesium uses to skip degenerate hops: two stops at one address get no arc, only the
  // stems that already mark them.
  if (!(distanceM > 5)) return null;
  const lift = arcLift(distanceM);
  // Half the target width in metres at the current camera, so the tube renders at ARC_WIDTH_PX
  // regardless of zoom. The hop's length no longer enters into it — every arc is the same weight,
  // which is what a route line should be.
  const radiusM =
    Math.min(
      Math.max((ARC_WIDTH_PX / 2) * metresPerPx, ARC_MIN_RADIUS_M),
      ARC_MAX_RADIUS_M
    ) * (active ? 1.25 : 1);

  // The ground at each end, so the arc springs from the terrain rather than from sea level. Lerped
  // across the hop rather than sampled per point: `queryTerrainElevation` is a DEM lookup per call
  // and 48 of them per arc is real work for a correction measured in metres.
  const groundFrom = groundAt(from.lat, from.lng);
  const groundTo = groundAt(to.lat, to.lng);

  const points = Array.from({ length: ARC_SAMPLES + 1 }, (_, i) => {
    const t = i / ARC_SAMPLES;
    return {
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
      // Character for character the profile `buildRouteGeometry` uses, so a trip drawn on either
      // engine arches by the same amount from the same `arcLift()`.
      heightM: groundFrom + (groundTo - groundFrom) * t + STEM_HEIGHT_M + lift * Math.sin(t * Math.PI),
    };
  });

  return { points, radiusM, color: hexToRgb(color), alpha };
}

/** `#rrggbb` to linear-ish 0..1 RGB for the tube shader. */
function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return [1, 1, 1];
  const value = parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/**
 * Cubic in-out, the same shape Cesium's `EasingFunction.CUBIC_IN_OUT` traces.
 *
 * Written out rather than reached for from a library: it is two lines, and having both engines
 * ease a stop flight on visibly different curves is exactly the kind of drift the `MapRenderer`
 * boundary exists to prevent.
 */
function cubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}


/** A closed ring of `STEM_SIDES` points around a stop, for the extruded stem footprint. */
function circleRing(lat: number, lng: number, radiusM: number): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= STEM_SIDES; i++) {
    const angle = (i / STEM_SIDES) * Math.PI * 2;
    ring.push(offsetMetres(lat, lng, radiusM * Math.cos(angle), radiusM * Math.sin(angle)));
  }
  return ring;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

// Same teardrop the Cesium billboard uses, so the searched-for place is marked identically on
// both engines. Red marks the place you searched for, blue marks the route through it.
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32"><path d="M12 .8C6 .8 1.2 5.6 1.2 11.6c0 8 10.8 19.6 10.8 19.6s10.8-11.6 10.8-19.6C22.8 5.6 18 .8 12 .8z" fill="#FF3B30" stroke="#C1271F" stroke-width="1.2" stroke-linejoin="round"/><circle cx="12" cy="11.6" r="4.2" fill="#fff"/></svg>`;
const PIN_DATA_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PIN_SVG)}`;
