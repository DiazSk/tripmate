import { NextRequest, NextResponse } from "next/server";
import { getCandidatePoisCached } from "@/lib/serverFetchCached";

/**
 * `GET ?lat=&lng=` → real named places within a short walk of a point on the globe.
 *
 * Behind "add a stop by clicking the map" in the split editor. A click gives coordinates and
 * nothing else, and a `Stop` needs a name — so rather than inventing one, this asks what is
 * actually standing there and lets the traveler pick.
 *
 * Deliberately not a reverse geocode. An address ("R. Augusta 112") is not a stop; a plan reads
 * as a list of places, and the itinerary, the prompt and the marker cards all assume a venue's
 * own name. Picking from real POIs also means every added stop already has coordinates that
 * belong to a real thing, rather than wherever the pointer happened to land on a rooftop.
 *
 * Always 200 with `{pois, available}`. `pois` is a list, empty when nothing is near: a click on open
 * water or moorland legitimately has nothing. `available: false` means a configured lookup failed
 * (copy row T-72), so the picker says the places service didn't answer rather than "nothing
 * listed". With no `OPENTRIPMAP_API_KEY` there is no lookup to fail: that deployment answers
 * `available: true` with an empty list, and the picker says nothing about a service.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  // 250m: far enough that a click landing on the wrong side of a roof still finds the building,
  // tight enough that the list is places the traveler can see from where they pointed.
  // `minRate: 0` because a rating floor answers "what is this city known for", and this is
  // asking "what is here" — the cafe being pointed at is unrated.
  const pois = await getCandidatePoisCached(lat, lng, 8, { radiusM: 250, minRate: 0 });
  // `getCandidatePois` returns null both for "no key" and for a failed fetch. Only the second is
  // T-72; a deployment that never configured the key isn't failing, it just has no lookup.
  const configured = !!process.env.OPENTRIPMAP_API_KEY;
  return NextResponse.json({ pois: pois ?? [], available: pois !== null || !configured });
}
