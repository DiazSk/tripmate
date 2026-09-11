/**
 * The geometry behind the exported itinerary's offline map: one Overpass query, simplified into
 * SVG path data and handed to `mapSvg.ts`.
 *
 * Fail-soft like `exportPhotos.ts`, and for the same reason — an export with no map is a complete
 * document, so nothing here throws. Every failure returns `null` and the section is omitted.
 *
 * The pure half (`buildMapQuery`, `parseMapContext`, `mapModeFor`) is exported so the suite can
 * reach it without a network, matching how `withinBudget` is tested in `exportPhotos.test.mjs`.
 *
 * NOTE: nothing in this file may emit an absolute URL into its output. `itineraryHtml.test.mjs`
 * asserts the whole document is free of them, and that includes path data and attribution text.
 */

import { getMapGeometry, saveMapGeometry } from "../db";
import type { Trip } from "../types";
import {
  boundsDiagonalKm,
  boundsOf,
  fitFrame,
  frameBounds,
  isUsableCoord,
  padBounds,
  projectToFrame,
  type Bounds,
  type LatLng,
  type MapFrame,
} from "./mapProjection";
import { joinWithinBudget, pathOf, projectSegment, segmentPaths } from "./mapGeometry";

/**
 * `placeSearch.ts`'s three instances plus OSM France's, which is the other long-standing public
 * global interpreter. The fourth was added after all three of the original set refused this IP at
 * once during a testing session — the failure that also motivated the geometry cache below. More
 * mirrors is the cheap half of the fix; not needing to ask is the durable half.
 */
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

/**
 * Per **attempt**, not per walk. This used to be 20s against a 20s overall deadline, which meant a
 * single mirror that accepted the connection and then queued consumed the entire budget and the
 * other three were never asked — measured as a 20.1s export with an empty basemap while a working
 * mirror sat untried. A bbox road query either answers in a few seconds or the instance is
 * queueing, so a tight cap costs nothing real and buys three more chances.
 */
const OVERPASS_TIMEOUT_MS = 7_000;

/** Wall-clock cap on the whole map walk, mirroring `PHOTO_WALK_DEADLINE_MS`. This runs concurrent
 *  with the photo walk inside the export route's `Promise.all`, so it bounds the download click. */
export const MAP_FETCH_DEADLINE_MS = 30_000;

/** `out geom` over a wide box of secondary roads genuinely runs to tens of megabytes. Buffering
 *  that only to simplify it away is worth one header check. */
const MAX_RESPONSE_BYTES = 24_000_000;

/** Path-data caps. Small next to the 1.2MB `MAX_TOTAL_BYTES` the same file already spends on
 *  imagery — a well-simplified city network lands at 30-60KB and the caps only fire on a
 *  pathological response. */
export const MAX_ROAD_CHARS = 90_000;
export const MAX_WATER_CHARS = 50_000;

/** Above this the frame is wider than any road network is legible in, and the query would return
 *  a country's worth of geometry to draw as grey mush. */
export const CITY_MODE_MAX_DIAGONAL_KM = 60;

/** SVG user units of allowed error on a 1000-unit canvas — well under a pixel at any render size,
 *  and the single biggest lever on the emitted byte count. */
const SIMPLIFY_TOLERANCE = 0.4;

/** How far past the stops the frame reaches, so pins never sit on the edge. */
const BOUNDS_PADDING = 0.18;

export type MapMode = "city" | "region";

/** Mirrors the same list in `itineraryHtml.ts` — an unrecognised category falls to the neutral. */
const STOP_CATEGORIES: readonly string[] = ["food", "entry", "transit", "other"];

export interface ExportMapStop {
  x: number;
  y: number;
  name: string;
  /** The stop's 1-based position **in the day's list**, not among the stops that happen to have
   *  coordinates. A stop saved without a position draws no dot but still consumes its number, so
   *  the dot labelled 4 is always the fourth row of the day below it. */
  n: number;
  category: string;
}

export interface ExportMapDay {
  index: number;
  date: string;
  /** The day's route as a polyline through its stops. Never dropped by the budget. */
  d: string;
  stops: ExportMapStop[];
}

export interface ExportMap {
  width: number;
  height: number;
  /** The frame, as the four numbers the client runtime re-projects a live GPS fix through. */
  x0: number;
  y0: number;
  spanX: number;
  spanY: number;
  /** SVG units per metre, for the GPS accuracy halo. */
  unitsPerMetre: number;
  mode: MapMode;
  /** False when a city-scale map shipped with no road or water geometry behind it — the fetch
   *  failed and there was nothing cached. The document says so rather than presenting an empty
   *  grey box as if it were the city. */
  basemap: boolean;
  roads: string;
  waterFill: string;
  waterLine: string;
  days: ExportMapDay[];
}

/** A trip spanning more than one city gets no road network — see `CITY_MODE_MAX_DIAGONAL_KM`. */
export function mapModeFor(bounds: Bounds): MapMode {
  return boundsDiagonalKm(bounds) <= CITY_MODE_MAX_DIAGONAL_KM ? "city" : "region";
}

/**
 * One union query for the whole basemap, in **bbox form rather than `around:`**. `arrivalPoints.ts`
 * measured the difference on a comparable query: the radius form timed out server-side at 32s and
 * reported it as an HTTP 200 with a `remark`, while the box form answered in 18s off the spatial
 * index.
 *
 * `["name"]` on the water clauses is load-bearing. Unnamed `natural=water` at city scale is
 * retention ponds and swimming pools — hundreds of them — and filtering at the query shrinks the
 * response rather than just the work done on it.
 */
export function buildMapQuery(bounds: Bounds): string {
  const box = `${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng}`;
  return (
    `[out:json][timeout:25];(` +
    `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${box});` +
    `way["natural"="coastline"](${box});` +
    `way["natural"="water"]["name"](${box});` +
    `relation["natural"="water"]["name"](${box});` +
    `way["waterway"="river"](${box});` +
    `);out geom;`
  );
}

const host = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

interface OverpassGeometry {
  lat: number;
  lon: number;
}

interface OverpassElement {
  type?: string;
  tags?: Record<string, string>;
  geometry?: OverpassGeometry[];
  members?: { role?: string; geometry?: OverpassGeometry[] }[];
}

export interface MapContext {
  roads: LatLng[][];
  /** Closed rings — lakes and reservoirs. Filled. */
  waterFill: LatLng[][];
  /** Open lines — coastline and rivers. Stroked; filling a coastline draws a blob, because OSM
   *  models it as a line with land on its left rather than as a polygon. */
  waterLine: LatLng[][];
}

/**
 * Splits the union query's elements back into the two layers by tag.
 *
 * A relation answers `out geom` with geometry on its *members* rather than on itself, which is the
 * only way a multipolygon lake — Zürichsee, Lake Geneva — ever arrives. Reading only `el.geometry`
 * silently drops exactly the water bodies that make a lakeside city recognisable.
 */
export function parseMapContext(elements: OverpassElement[]): MapContext {
  const context: MapContext = { roads: [], waterFill: [], waterLine: [] };

  for (const element of elements) {
    const tags = element.tags ?? {};
    const target =
      typeof tags.highway === "string"
        ? context.roads
        : tags.natural === "water"
          ? context.waterFill
          : tags.natural === "coastline" || typeof tags.waterway === "string"
            ? context.waterLine
            : null;
    if (!target) continue;
    const geometries: OverpassGeometry[][] = [];

    if (Array.isArray(element.geometry)) {
      geometries.push(element.geometry);
    } else if (Array.isArray(element.members)) {
      for (const member of element.members) {
        // Inner rings are holes; drawing them as outlines would put a stroke through the lake.
        if (member.role === "inner") continue;
        if (Array.isArray(member.geometry)) geometries.push(member.geometry);
      }
    }

    for (const geometry of geometries) {
      if (geometry.length < 2) continue;
      target.push(geometry.map((point) => ({ lat: point.lat, lng: point.lon })));
    }
  }

  return context;
}

/**
 * Asks each mirror in turn. `null` only when every one of them failed.
 *
 * **Deliberately still its own loop, not `src/lib/overpass.ts`'s.** The comment here used to say
 * the other callers "use the primary alone" — that stopped being true when `overpass.ts` gave all
 * five of them the shared failover. What keeps this copy separate now is a genuinely different
 * contract, not neglect:
 *
 *  - a **deadline** shared across the whole walk, because this blocks a Download button the
 *    traveler just pressed, where the others fire while they are doing something else;
 *  - a 7s per-attempt cap derived from that deadline (see `OVERPASS_TIMEOUT_MS` above);
 *  - a `content-length` guard against an oversized bbox response;
 *  - a fourth mirror the shared list does not carry;
 *  - a one-line `console.warn` naming every mirror that refused.
 *
 * It does carry the `remark` check, independently of the shared client — a server-side Overpass
 * timeout arrives as HTTP 200 and is the likely failure on a wide bbox, not the exceptional one.
 * If these two ever need to converge, the deadline is the thing to lift into `overpass.ts`.
 */
async function askOverpass(body: string, deadline: number): Promise<OverpassElement[] | null> {
  const failures: string[] = [];

  for (const url of OVERPASS_URLS) {
    if (Date.now() > deadline) {
      failures.push("deadline");
      break;
    }
    try {
      const res = await fetch(url, {
        // Overpass's Apache front-end 406s a bare fetch() — undici sends no `Accept` header by
        // default and the front-end reads that as "accepts nothing". Same set `roads.ts` uses.
        method: "POST",
        headers: { "Content-Type": "text/plain", Accept: "*/*", "User-Agent": "TripMate/1.0" },
        body,
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(OVERPASS_TIMEOUT_MS, deadline - Date.now())),
        ),
      });
      if (!res.ok) {
        failures.push(`${host(url)} ${res.status}`);
        continue;
      }

      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        failures.push(`${host(url)} too-large`);
        continue;
      }

      const data = (await res.json()) as { elements?: OverpassElement[]; remark?: string };

      // Overpass reports a server-side query timeout as HTTP **200** with empty `elements` and a
      // `remark` — the trap `api/arrival-points/route.ts` documents. On a wide bbox it is the
      // likely failure, not the exceptional one, so it counts as this mirror failing rather than
      // as "this city has no roads".
      if (typeof data.remark === "string") {
        failures.push(`${host(url)} remark`);
        continue;
      }

      return data.elements ?? [];
    } catch (err) {
      // Refused, timed out, or answered something that is not JSON. Next mirror.
      failures.push(`${host(url)} ${(err as Error)?.name ?? "error"}`);
    }
  }

  // One line, only when every mirror is gone. Silence here is what made an empty basemap look
  // like a rendering bug rather than an upstream one.
  console.warn(`[export map] no Overpass mirror answered: ${failures.join(", ")}`);
  return null;
}

/** Rounded to ~100m so two trips through the same neighbourhood share one cached row. */
export function boxKey(bounds: Bounds): string {
  return [bounds.minLat, bounds.minLng, bounds.maxLat, bounds.maxLng]
    .map((n) => n.toFixed(3))
    .join(",");
}

function buildMap(trip: Trip, frame: MapFrame, mode: MapMode, context: MapContext | null): ExportMap {
  const days: ExportMapDay[] = trip.itinerary.days.map((day, index) => {
    // Numbered before filtering, so a stop with no coordinates costs its dot and not the numbering.
    const numbered = (day.stops ?? [])
      .map((stop, i) => ({ stop, n: i + 1 }))
      .filter((entry) => isUsableCoord(entry.stop));

    return {
      index,
      date: day.date,
      // Routes and pins are built outside the byte budget: they are the content, not the context.
      d: pathOf(projectSegment(numbered.map((entry) => entry.stop), frame)),
      stops: numbered.map(({ stop, n }) => {
        const { x, y } = projectToFrame(stop.lat, stop.lng, frame);
        return {
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
          name: stop.name,
          n,
          category: STOP_CATEGORIES.includes(stop.category) ? stop.category : "other",
        };
      }),
    };
  });

  return {
    width: frame.width,
    height: frame.height,
    x0: frame.x0,
    y0: frame.y0,
    spanX: frame.spanX,
    spanY: frame.spanY,
    unitsPerMetre: frame.unitsPerMetre,
    mode,
    basemap: mode === "city" && context !== null,
    roads: context
      ? joinWithinBudget(segmentPaths(context.roads, frame, SIMPLIFY_TOLERANCE), MAX_ROAD_CHARS)
      : "",
    waterFill: context
      ? joinWithinBudget(
          segmentPaths(context.waterFill, frame, SIMPLIFY_TOLERANCE, false),
          MAX_WATER_CHARS,
        )
      : "",
    waterLine: context
      ? joinWithinBudget(segmentPaths(context.waterLine, frame, SIMPLIFY_TOLERANCE), MAX_WATER_CHARS)
      : "",
    days,
  };
}

/** Keyed on the trip and the box its stops occupy, so an edit that moves a stop re-fetches but a
 *  second Download click does not. The export route is `force-dynamic` with `no-store`, and the
 *  shared Overpass instances rate-limit by *our* IP across every user — so this is usage-policy
 *  compliance rather than an optimisation. */
const MEMO_TTL_MS = 10 * 60_000;
const memo = new Map<string, { at: number; map: ExportMap | null }>();

/** Never throws. `null` means "no map section", which is a complete document. */
export async function collectExportMap(trip: Trip): Promise<ExportMap | null> {
  try {
    const stops = trip.itinerary.days.flatMap((day) => day.stops ?? []);
    const bounds = boundsOf(stops);
    // An itinerary saved before stops carried coordinates has nothing to draw.
    if (!bounds) return null;

    const padded = padBounds(bounds, BOUNDS_PADDING);
    const frame = fitFrame(padded);
    const mode = mapModeFor(padded);

    const key = [
      trip.id,
      mode,
      padded.minLat.toFixed(4),
      padded.minLng.toFixed(4),
      padded.maxLat.toFixed(4),
      padded.maxLng.toFixed(4),
    ].join(":");

    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.map;

    let context: MapContext | null = null;
    if (mode === "city") {
      const box = boxKey(frameBounds(frame));

      // The cache is checked first and written on every success, because the alternative is what
      // shipped once: three rate-limited mirrors and a map with nothing behind the pins.
      const cached = getMapGeometry(box);
      if (cached) {
        try {
          context = JSON.parse(cached.context_json) as MapContext;
        } catch {
          context = null;
        }
      }

      if (!context) {
        const elements = await askOverpass(
          buildMapQuery(frameBounds(frame)),
          Date.now() + MAP_FETCH_DEADLINE_MS,
        );
        if (elements) {
          const fetched = parseMapContext(elements);
          // An answer with no geometry at all is a refusal wearing a 200; caching it would make
          // this city permanently blank.
          if (fetched.roads.length || fetched.waterFill.length || fetched.waterLine.length) {
            context = fetched;
            try {
              saveMapGeometry(box, JSON.stringify(fetched));
            } catch {
              // A cache write failing must never cost the traveler their map.
            }
          }
        }
      }
    }

    const map = buildMap(trip, frame, mode, context);
    memo.set(key, { at: Date.now(), map });
    return map;
  } catch {
    // An export with no map is a complete document; there is no error path worth surfacing.
    return null;
  }
}
