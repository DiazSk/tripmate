import { NextResponse } from "next/server";
import { getTripByShareToken } from "@/lib/db";
import { renderTripDocument } from "@/lib/export/tripDocument";
import { copyForRecipient } from "@/lib/sharedTrip";
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

/**
 * Copy row G-19, for a link that is revoked or never was. A bare line of plain text told the person
 * holding it nothing about what to do, and they are usually a friend in a group chat who has no
 * account. Self-contained for the reason the shared document is: no framework, no network, nothing
 * that can itself fail. Static, so there is nothing to escape.
 */
const UNAVAILABLE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Shared trip not available · TripMate</title>
<style>
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:1.25rem;box-sizing:border-box;background:#090b10;color:#fff;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:34rem;display:grid;justify-items:start;gap:.75rem;padding:1.25rem 1.375rem;border:1px dashed rgba(255,255,255,.28);border-radius:.25rem}
h1{margin:0;font-size:1.0625rem;font-weight:600}
p{margin:0;font-size:.9375rem;color:rgba(255,255,255,.86)}
a{display:inline-flex;align-items:center;height:2.5rem;padding:0 1.125rem;border-radius:2px;background:#ff7e15;color:#1f2a44;font-weight:600;font-size:.9rem;text-decoration:none}
a:focus-visible{outline:2px solid #ff7e15;outline-offset:3px}
</style></head>
<body><main>
<h1>This shared trip isn&rsquo;t available.</h1>
<p>Its owner may have stopped sharing it; ask them for a new link.</p>
<a href="/">Plan your own trip</a>
</main></body></html>`;

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const row = getTripByShareToken(token);
  // Unknown and revoked are one answer. Saying "this link used to work" would confirm both that
  // the trip exists and that the holder once had access to it, which is more than a withdrawn
  // link should give back.
  if (!row) {
    return new NextResponse(UNAVAILABLE_PAGE, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  }

  // The sender's real spending stays with the sender, as it does in `toSharedTrip`.
  const trip = toTripDetail(row);
  const html = await renderTripDocument({ ...trip, itinerary: copyForRecipient(trip.itinerary) });

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
