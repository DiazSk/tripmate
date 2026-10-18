import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getTrip, setTripShareToken } from "@/lib/db";
import { currentOwner } from "@/lib/ownerRequest";
import { writableOwners } from "@/lib/owner";
import { shareUrl } from "@/lib/share";

/**
 * Publishing a trip, and withdrawing it again.
 *
 * **The act is the feature.** Until this route is called a trip is readable only by its owner —
 * `readOwnTrip` gates the page, the print view, the export and `GET /api/trips/[id]` alike. A
 * `POST` here mints the one value that opens it to anybody holding the link, and a `DELETE`
 * takes it back. Nothing else in the app writes `share_token`.
 *
 * `force-dynamic` for the same reason the trip routes are: the answer depends on who is asking.
 */
export const dynamic = "force-dynamic";

/**
 * Mint a link, or hand back the one this trip already has.
 *
 * **Idempotent on purpose.** Pressing Share twice is the ordinary case — somebody sends the link
 * to one group chat and then another — and minting a fresh token on the second press would
 * silently break the first link while showing the sender a perfectly good one. Rotating a token
 * is a different intention, and it is spelled `DELETE` then `POST`.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trip = getTrip(id);
  const { id: ownerId } = await currentOwner();
  // Same 404 copy, and the same reason, as every other handler on this path: a trip somebody may
  // not touch must not be distinguishable from one that is not there. Checked before the
  // `existing` return below, or a stranger could read an already-minted token.
  if (!trip || !writableOwners(ownerId).includes(trip.owner_id)) {
    return NextResponse.json({ error: "That trip isn't saved here." }, { status: 404 });
  }

  const existing = trip.share_token;
  if (existing) return NextResponse.json({ token: existing, url: shareUrl(existing) });

  // UUIDv4, the id format everywhere else here — 122 bits of randomness, and nothing derived
  // from the trip it opens. See the `share_token` column note for why that separation matters.
  const token = randomUUID();
  if (!setTripShareToken(id, token, ownerId)) {
    return NextResponse.json({ error: "That trip isn't saved here." }, { status: 404 });
  }

  return NextResponse.json({ token, url: shareUrl(token) });
}

/**
 * Withdraw the link.
 *
 * A no-op on an unshared trip answers `ok` rather than 404: the caller asked for this trip not to
 * be shared, and it is not shared. Reporting failure would make an idempotent retry look broken.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trip = getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "That trip isn't saved here." }, { status: 404 });
  }

  const { id: ownerId } = await currentOwner();
  if (!setTripShareToken(id, null, ownerId)) {
    return NextResponse.json({ error: "That trip isn't saved here." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
