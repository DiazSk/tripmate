import { NextRequest, NextResponse } from "next/server";
import { fetchCityBoundary, fetchNearbyPlaces } from "@/lib/cityBoundary";

/**
 * `GET ?lat=&lng=` → the city's administrative outline and the towns around it.
 *
 * Both halves answer the same question a pin cannot: how far the destination actually extends,
 * and what the places just outside it are called.
 *
 * The two lookups run concurrently — they share nothing, and Overpass queues, so serialising
 * them would double the wait for no benefit. Always 200: either half may come back empty (a city
 * with no mapped relation, an Overpass outage) and the map simply draws less. Same fail-soft
 * contract as `/api/roads`.
 */
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  // The searched name helps disambiguate: at one set of coordinates several administrative
  // boundaries legitimately contain the point, and the name is the clearest signal of which one
  // the traveler meant. Optional — the `place=city` tag carries the decision without it.
  const name = req.nextUrl.searchParams.get("name") ?? undefined;
  const [boundary, nearby] = await Promise.all([
    fetchCityBoundary(lat, lng, name),
    fetchNearbyPlaces(lat, lng, 12, name),
  ]);
  // Also drop anything sharing the *matched* boundary's name, which is often the local spelling
  // ("Lisboa") rather than the searched one ("Lisbon") and so survives the filter above.
  const trimmed = boundary
    ? nearby.filter((p) => p.name.toLowerCase() !== boundary.name.toLowerCase())
    : nearby;
  return NextResponse.json({ boundary, nearby: trimmed });
}
