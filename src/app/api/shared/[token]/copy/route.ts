import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getTripByShareToken, insertTrip } from "@/lib/db";
import { currentOwnerId } from "@/lib/ownerRequest";
import { copyForRecipient } from "@/lib/sharedTrip";
import { toTripDetail } from "@/lib/tripPayload";

/**
 * Save a copy of a shared trip into the caller's own trips.
 *
 * **A new row, owned by whoever asked, and nothing else changes.** The sender's trip is only read;
 * the copy has its own id and its own owner, so every later edit to either is invisible to the
 * other. What the sender booked and spent stays with the sender — see `copyForRecipient`.
 *
 * Saved, not a draft: pressing Save a copy is the keeping. No sign-in is required, for the same
 * reason planning needs none — an anonymous owner's trips move onto an account at sign-in.
 */
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = getTripByShareToken(token);
  if (!row) return NextResponse.json({ error: "This link isn't active." }, { status: 404 });

  const shared = toTripDetail(row);
  const copy = insertTrip({
    id: randomUUID(),
    owner_id: await currentOwnerId(),
    destination: shared.destination,
    start_date: shared.startDate,
    end_date: shared.endDate,
    budget: shared.budget,
    itinerary_json: JSON.stringify(copyForRecipient(shared.itinerary)),
    timezone: shared.timezone ?? null,
    status: "saved",
  });
  return NextResponse.json({ id: copy.id }, { status: 201 });
}
