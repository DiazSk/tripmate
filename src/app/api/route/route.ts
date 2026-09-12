import { NextRequest, NextResponse } from "next/server";
import { type Pt, type RoutableMode, routableMode, routeLegs } from "@/lib/osrmRoute";
import type { TransportMode } from "@/lib/types";

/**
 * `GET ?profile=walk|bike|drive&stops=lat,lng|lat,lng[|…]` → the real road-network route between
 * each consecutive pair.
 *
 * **One request per day, fanned out to one cached OSRM call per leg.** The client wants a day at a
 * time — dedupe, cancellation and invalidation are then one key rather than N — while the cache
 * wants a leg at a time, because a per-leg row survives the reorder that a per-day row does not,
 * and reordering a day is this app's most common edit. Both are right, so the fan-out happens here.
 *
 * **An unroutable leg is `null` in the array, not an error.** Every consumer of this route treats a
 * missing leg as "fall back to what you already draw", and the whole degradation story rests on a
 * single leg failing without taking the day's other legs with it.
 *
 * Always 200 except for a malformed request (400) and throttling (429). The street path is an
 * enhancement over arcs the map already draws and numbers the planner already estimates, so an
 * OSRM outage costs a nicety rather than the map — the same posture as `/api/arrival-points`, and
 * for the same reason: an error the traveler cannot act on is worse than a quieter page.
 */

/** OSRM accepts more, but a day is the unit this serves and twelve stops is a long day. The cap is
 *  here rather than in `osrmRoute.ts` because it is about this endpoint's shape, not the source's. */
const MAX_STOPS = 12;

/**
 * Requests per minute per client.
 *
 * This is the only place in the app where an anonymous public request drives traffic at a free
 * community service whose access can be withdrawn without notice, which makes it a trust boundary
 * and not a place to be lazy. 60/min is far above any legitimate client — the map asks for one day
 * at a time — and far below anything that would get this app's IP dropped by FOSSGIS.
 *
 * Deliberately **not** `ipThrottle.ts`: that one is priced for LLM spend (3 per 10 minutes) and
 * returns `false` unconditionally unless `LLM_TRANSPORT === "api"`, which would leave this endpoint
 * completely open in exactly the environment where a development loop hammers it hardest.
 * Deliberately not extracted into a shared helper either — there is one caller.
 *
 * It counts **requests, not outbound fetches**, because a cache hit still costs this process work.
 * In-memory and per-process, the same posture as `ipThrottle.ts`: it resets on redeploy, and that
 * is fine, because the 90-day per-leg cache is what actually bounds steady-state outbound volume.
 * ponytail: fixed window, so a burst can straddle the boundary. Swap for a sliding one if that
 * ever shows up in the logs.
 */
const MAX_PER_MINUTE = 60;
const WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; windowStart: number }>();

function throttled(req: NextRequest): boolean {
  const key = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const seen = hits.get(key);
  if (!seen || now - seen.windowStart >= WINDOW_MS) {
    hits.set(key, { count: 1, windowStart: now });
    // Bounded so a stream of distinct forwarded-for values cannot grow this without limit.
    if (hits.size > 5_000) for (const [k, v] of hits) if (now - v.windowStart >= WINDOW_MS) hits.delete(k);
    return false;
  }
  seen.count += 1;
  return seen.count > MAX_PER_MINUTE;
}

/**
 * `lat,lng|lat,lng|…` → points, or `null` if any part of it is malformed.
 *
 * Rejected whole rather than repaired, matching how `/api/place-search` handles a bad polygon: a
 * coordinate is either right or it isn't, and a half-parsed list would route between places nobody
 * asked about.
 *
 * The empty-string check is the `Number(null) === 0` trap in its other costume — `Number("")` is
 * also `0`, so `"48.86,"` would otherwise parse as a legal point in the Gulf of Guinea rather than
 * as the truncated input it is.
 */
function parseStops(raw: string): Pt[] | null {
  const parts = raw.split("|");
  if (parts.length < 2 || parts.length > MAX_STOPS) return null;

  const stops: Pt[] = [];
  for (const part of parts) {
    const halves = part.split(",");
    if (halves.length !== 2) return null;
    const [latRaw, lngRaw] = halves.map((h) => h.trim());
    if (!latRaw || !lngRaw) return null;
    const lat = Number(latRaw);
    const lon = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    stops.push({ lat, lon });
  }
  return stops;
}

/** An unknown profile narrows to walking rather than 400-ing — a stale bookmarked URL should give
 *  a slightly different answer, not an error. Same posture as `/api/place-search`'s categories. */
function parseProfile(raw: string | null): RoutableMode {
  return routableMode((raw ?? "walk") as TransportMode) ?? "walk";
}

export async function GET(req: NextRequest) {
  if (throttled(req)) {
    return NextResponse.json(
      { error: "Too many route requests — slow down and try again shortly." },
      { status: 429, headers: { "Retry-After": "10" } }
    );
  }

  // `params.get` first, then `Number` — never the other way round. See `parseStops`.
  const raw = req.nextUrl.searchParams.get("stops");
  if (!raw) {
    return NextResponse.json({ error: "stops is required" }, { status: 400 });
  }
  const stops = parseStops(raw);
  if (!stops) {
    return NextResponse.json(
      { error: `stops must be 2 to ${MAX_STOPS} points, each "lat,lng"` },
      { status: 400 }
    );
  }
  const profile = parseProfile(req.nextUrl.searchParams.get("profile"));

  try {
    const routes = await routeLegs(
      stops.slice(1).map((to, i) => ({ from: stops[i], to, mode: profile }))
    );
    return NextResponse.json({
      profile,
      legs: routes.map((r) =>
        r ? { distanceM: r.distanceM, durationS: r.durationS, points: r.geometry } : null
      ),
    });
  } catch (err) {
    // `routeLegs` already swallows a per-leg failure into a null, so reaching here means something
    // structural. Still a 200 with every leg null: see the note at the top of this file.
    console.error("[route] OSRM lookup failed", err);
    return NextResponse.json({ profile, legs: stops.slice(1).map(() => null) });
  }
}
