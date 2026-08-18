import { NextRequest, NextResponse } from "next/server";
import { fetchRawTrip } from "@/lib/tripFetch";

/**
 * Step 2a: the preference-independent data fetch, fired the moment a trip is submitted
 * (alongside /api/destination-context) so the bundle is ready by the time Step 2b's POI
 * picker — or Step 3's generation, later — needs it.
 *
 * The fetch itself lives in `fetchRawTrip()` so the dev benchmark can build a custom trip through
 * the identical path; this route is just the HTTP shell.
 */
export async function POST(req: NextRequest) {
  const { destination, startDate, endDate } = await req.json();
  if (!destination || !startDate || !endDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const rawFetch = await fetchRawTrip({ destination, startDate, endDate });
  return NextResponse.json({ ok: true, rawFetch });
}
