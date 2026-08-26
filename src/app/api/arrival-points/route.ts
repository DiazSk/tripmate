import { NextRequest, NextResponse } from "next/server";
import {
  OverpassArrivalElement,
  buildArrivalPointsQuery,
  parseArrivalPoints,
} from "@/lib/arrivalPoints";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
/** Longer than `roads.ts`'s 30s, and measured rather than guessed: this query came back in 18s
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
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      // Overpass's Apache front-end 406s a bare fetch() — undici sends no `Accept` header by
      // default, and the server reads that as "no acceptable representation" rather than "any".
      headers: { "Content-Type": "text/plain", Accept: "*/*", "User-Agent": "TripMate/1.0" },
      body: buildArrivalPointsQuery(lat, lon),
      signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Overpass API returned ${res.status}`);

    const data = await res.json();

    // Overpass reports a server-side query timeout as HTTP **200** with an empty `elements` array
    // and a `remark`. Without this check that reads as "there are no airports near Kyoto", which
    // is the exact confusion the null-vs-empty convention exists to prevent (holidays.ts) — and it
    // is what this route did on its first run.
    if (typeof data?.remark === "string") {
      throw new Error(`Overpass remark: ${data.remark}`);
    }

    const elements: OverpassArrivalElement[] = Array.isArray(data?.elements) ? data.elements : [];
    return NextResponse.json({ points: parseArrivalPoints(elements, { lat, lon }) });
  } catch (err) {
    console.error("[arrival-points] Overpass lookup failed", err);
    return NextResponse.json({ points: [] });
  }
}
