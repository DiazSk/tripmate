import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { clerkConfigured } from "@/lib/clerkConfig";
import { clerkUserForOwner, getTripByShareToken } from "@/lib/db";
import { toSharedTrip } from "@/lib/sharedTrip";

/**
 * A shared trip as data, for the phone.
 *
 * `/s/[token]` answers the same link with a finished HTML document, which is right for a browser
 * and useless to an app that draws the plan itself. Same token, same gate, same one answer for an
 * unknown and a withdrawn link — see that route for why the two must not be told apart. What
 * differs is the payload: `toSharedTrip` picks the fields a recipient may see rather than handing
 * over the owner's `Trip`.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = getTripByShareToken(token);
  if (!row) return NextResponse.json({ error: "This link isn't active." }, { status: 404, headers: HEADERS });
  return NextResponse.json({ trip: toSharedTrip(row, await senderName(row.owner_id)) }, { headers: HEADERS });
}

/**
 * The sender's first name, from Clerk, which is the only place a name is kept.
 *
 * Fail-soft like every other outside call here: no accounts, no account behind this trip, or Clerk
 * not answering all give null, and the phone then says "A trip shared with you". A name is a
 * courtesy on this screen; the plan is the content.
 */
async function senderName(ownerId: string): Promise<string | null> {
  if (!clerkConfigured()) return null;
  const userId = clerkUserForOwner(ownerId);
  if (!userId) return null;
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    return user.firstName?.trim() || null;
  } catch {
    return null;
  }
}
