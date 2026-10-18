import { NextRequest, NextResponse } from "next/server";
import { geocodeAnchors } from "@/lib/anchorGeocode";
import { throttle } from "@/lib/ipThrottle";
import { limitResponse } from "@/lib/limitResponse";
import { geocodeDestinationCached } from "@/lib/serverFetchCached";

/**
 * Where the destination is — or, with `place`, where one named place in it is. The second form is
 * the planner's "look again" on a saved place that was not found: the same geocoder `/api/import`
 * ends in, for one name, without the model call that reading a pasted list needs.
 */
export async function GET(req: NextRequest) {
  const destination = req.nextUrl.searchParams.get("destination");
  if (!destination) {
    return NextResponse.json({ error: "Missing destination" }, { status: 400 });
  }
  const place = req.nextUrl.searchParams.get("place")?.trim().slice(0, 200);
  // Only the place form fans out to Photon and Overpass, so only it is held to a per-IP cap.
  if (place) {
    const limit = throttle(req, "geocode-place");
    if (limit.limited) return limitResponse(limit, "geocode-place");
  }

  try {
    const geo = await geocodeDestinationCached(destination);
    if (!geo) {
      // Not 404 for the place form: there, 404 means "the place is not here", and the planner says
      // exactly that. An unplaceable destination is a failure to look, not an answer.
      return NextResponse.json({ error: "Couldn't find that destination" }, { status: place ? 422 : 404 });
    }
    if (place) {
      const [hit] = await geocodeAnchors([{ name: place, lat: null, lng: null, priority: "want" }], { lat: geo.lat, lon: geo.lon });
      if (hit.lat === null || hit.lng === null) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ lat: hit.lat, lng: hit.lng, name: place, area: hit.area ?? null });
    }
    return NextResponse.json({ lat: geo.lat, lng: geo.lon, name: geo.name });
  } catch {
    return NextResponse.json({ error: "Geocoding failed" }, { status: 500 });
  }
}
