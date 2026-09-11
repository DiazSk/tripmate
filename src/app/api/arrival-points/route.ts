import { NextRequest, NextResponse } from "next/server";
import {
  OverpassArrivalElement,
  buildArrivalPointsQuery,
  parseArrivalPoints,
} from "@/lib/arrivalPoints";
import { TTL, cached } from "@/lib/fetchCache";
import { askOverpass } from "@/lib/overpass";

/** Longer than the shared default, and measured rather than guessed: this query came back in 18s
 *  against the public instance, almost all of it queue wait. The `[timeout:25]` inside the query
 *  is an instruction to Overpass about its own execution budget, not a cap on how long this
 *  process waits — only the abort signal is that. Nothing is blocked on this either way; it runs
 *  while the traveler is still filling in dates. */
const OVERPASS_TIMEOUT_MS = 45_000;

/**
 * `GET ?lat=&lon=` → the airports and stations a traveler could arrive at.
 *
 * Its own route rather than a field on `/api/trip-fetch` because of when it's needed: trip-fetch
 * fires as the traveler *leaves* the basics step, which is after the arrive/depart fields have
 * already been filled in. This one fires the moment the destination resolves.
 *
 * Always 200. The field it feeds is optional and free-text, so an Overpass outage costs the
 * traveler a convenience, not the form — degrading to an empty list is the honest response, and a
 * 502 here would surface as an error on a question nobody was required to answer.
 */
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });
  }

  try {
    // The `remark` check this route used to carry itself now lives in `askOverpass` — Overpass
    // reports a server-side query timeout as HTTP 200 with an empty `elements` and a `remark`,
    // and every other caller was accepting that as a real empty answer. Moving it into the shared
    // client fixed it for all five of them and made a remark fall through to the next mirror
    // rather than straight to the catch below.
    // Parsed before caching, not raw: the points are what every caller wants, and the raw
    // element list for a wide airport/station query is far larger than the handful of names it
    // reduces to. 2dp on the key ≈ 1.1km, well inside this query's radius.
    const points = await cached(
      `arrive:${lat.toFixed(2)}:${lon.toFixed(2)}`,
      TTL.STATIC,
      async () => {
        const elements = (await askOverpass(buildArrivalPointsQuery(lat, lon), {
          timeoutMs: OVERPASS_TIMEOUT_MS,
        })) as OverpassArrivalElement[] | null;
        if (elements === null) return null;

        const parsed = parseArrivalPoints(elements, { lat, lon });
        // `null` rather than `[]` on an empty result. Somewhere genuinely has no airport or
        // station within range, but so does a throttled query, and the two are indistinguishable
        // here — so the cheap read is re-asking next time rather than freezing "nowhere to
        // arrive" for ninety days. This field is optional and free-text either way.
        return parsed.length ? parsed : null;
      }
    );
    if (points === null) throw new Error("Overpass unavailable on every mirror, and nothing cached");

    return NextResponse.json({ points });
  } catch (err) {
    console.error("[arrival-points] Overpass lookup failed", err);
    return NextResponse.json({ points: [] });
  }
}
