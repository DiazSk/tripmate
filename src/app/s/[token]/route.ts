import { NextResponse } from "next/server";
import { getTripByShareToken } from "@/lib/db";
import { renderTripDocument } from "@/lib/export/tripDocument";
import { toTripDetail } from "@/lib/tripPayload";

/**
 * A shared trip, for whoever holds the link.
 *
 * **The one unauthenticated whole-trip read in the app**, and the only one there should be: every
 * other path now goes through `readOwnTrip`. What makes it safe is that it is keyed on a token
 * the owner chose to mint rather than on the trip's own id, and revoking sets that token to null
 * so the link stops resolving without the trip changing identity.
 *
 * **A route handler, not a page, because the document already exists.** `renderItineraryHtml` was
 * written for the traveller's downloadable copy — a self-contained file with the trip drawn as a
 * line map, no network, no scripts from anywhere. That is exactly what a public trip page is, and
 * the alternative was a second read-only rendering of an itinerary that would drift from the
 * first. The recipient therefore sees a finished document: no chat, no Keep, no cost entry, and
 * no controls whose writes the API would refuse.
 *
 * The cost of reusing it: no globe and no interactivity, which the owner's own page has. That is
 * the right trade for a link somebody opens once on a phone in a group chat, and it is the whole
 * reason this could ship as a route rather than a project.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const row = getTripByShareToken(token);
  // Unknown and revoked are one answer. Saying "this link used to work" would confirm both that
  // the trip exists and that the holder once had access to it, which is more than a withdrawn
  // link should give back.
  if (!row) {
    return new NextResponse("This link isn't active.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const html = await renderTripDocument(toTripDetail(row));

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // No `Content-Disposition`: the export downloads these same bytes, this one opens them.
      // `no-store` because the plan is edited in place and a shared link that served a cached
      // copy would show the group a day its planner had already changed — the same reason the
      // export route carries it.
      "Cache-Control": "no-store",
      // The plan is the owner's to circulate, not a search result. This does not make the link
      // private — anybody holding it can open it — it keeps a trip out of an index the owner
      // never submitted it to.
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
