import { NextRequest, NextResponse } from "next/server";
import { getCandidatePois } from "@/lib/pois";

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
 * Always 200 with a list, possibly empty. A click on open water or moorland legitimately has
 * nothing near it, and so does a missing `OPENTRIPMAP_API_KEY` — same fail-soft contract as
 * `getCandidatePois` itself, and the caller shows "nothing here" either way rather than an
 * error the traveler cannot act on.
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
  const pois = await getCandidatePois(lat, lng, 8, { radiusM: 250, minRate: 0 });
  return NextResponse.json({ pois });
}
