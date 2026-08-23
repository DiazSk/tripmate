import { NextRequest, NextResponse } from "next/server";
import { resolveOriginAirport } from "@/lib/originAirport";
import { fetchFlightEstimate } from "@/lib/flights";

/**
 * `GET ?origin=&destination=&start=&end=&adults=` → a real round-trip airfare estimate, or null.
 * `GET ?iata=&destination=&start=&end=&adults=` — same, but skips airport resolution entirely.
 *
 * Exists so the form can say what the flight costs BEFORE a two-minute generation commits to
 * planning against `budget − flights`. Without it the deduction is only ever explained after the
 * fact, on a plan the traveler has already waited for.
 *
 * Its own route rather than a field on an existing one because of when it's needed: the traveler
 * is still filling in the form, and the same lookups run again server-side during generation,
 * where they are authoritative for the arithmetic. This one is purely to set expectations.
 *
 * The `iata` form exists because resolving an airport (geocode + Overpass) measured several
 * seconds on its own, on top of the flight search itself — and the client already runs that same
 * resolution for the "Flying from" field's own feedback (reusing `/api/geocode` +
 * `/api/arrival-points`, the same two calls the arrive/depart fields already use). Passing the
 * IATA it already has skips a redundant resolve here, on top of the process-lifetime cache
 * `resolveOriginAirport` now keeps for the `origin` form.
 *
 * Always 200 once the inputs are present. `null` is a real answer here — no airport resolved, no
 * route priced, or the upstream is down — and this feeds an optional caption, so a 502 would
 * surface an error on a question nobody was required to answer. Same reasoning as
 * `api/arrival-points`.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const origin = params.get("origin")?.trim();
  const iataParam = params.get("iata")?.trim().toUpperCase();
  const destination = params.get("destination")?.trim();
  const start = params.get("start");
  const end = params.get("end");
  if (!(origin || iataParam) || !destination || !start || !end) {
    return NextResponse.json(
      { error: "destination, start and end are required, plus one of origin or iata" },
      { status: 400 }
    );
  }

  const adults = Number(params.get("adults"));

  try {
    const iata = iataParam || (await resolveOriginAirport(origin!))?.iata;
    if (!iata) return NextResponse.json({ estimate: null });

    const estimate = await fetchFlightEstimate({
      departureIata: iata,
      destination,
      outboundDate: start,
      returnDate: end,
      adults: Number.isFinite(adults) && adults > 0 ? adults : undefined,
    });
    return NextResponse.json({ estimate });
  } catch (err) {
    console.error("[flight-estimate] lookup failed", err);
    return NextResponse.json({ estimate: null });
  }
}
