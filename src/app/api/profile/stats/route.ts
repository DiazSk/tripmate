import { NextResponse } from "next/server";
import { profileStats } from "@/lib/profileStats";
import { currentOwner } from "@/lib/ownerRequest";

/**
 * `GET /api/profile/stats` → `{ trips, places, spend }` — what somebody's kept trips add up to.
 *
 * **Its own route rather than three fields on `GET /api/trips`, and that is deliberate.**
 * `listTrips` stopped selecting `itinerary_json` because every caller read it and dropped it, which
 * meant loading every stored plan to draw a list of destinations and dates. Hanging `spend` off
 * that route would put the cost back on the memories wall — the screen people actually open — to
 * serve one figure on the profile tab. This route reads itineraries only when the profile asks.
 *
 * **`places`, not "countries".** The iOS app derives a country by taking the last comma-separated
 * part of the destination, which makes "Tokyo" a country called Tokyo. `destination` is free text
 * and there is no country on the row, so the honest figure is the number of distinct destinations —
 * and "places" is already the word the memories header uses.
 *
 * **`spend` is real spend**, through the same `tripSpend` the trip screen's budget bar uses, so a
 * cost the traveller corrected counts here too and the two surfaces cannot disagree.
 *
 * Always 200. Somebody with no trips has a record of three zeroes, which is a true answer and not
 * an error; a row whose itinerary will not parse is skipped rather than failing the whole figure,
 * because one bad plan should not blank the other nine.
 */
export async function GET() {
  const { id: ownerId, signedIn } = await currentOwner();
  return NextResponse.json(profileStats(ownerId, signedIn));
}
