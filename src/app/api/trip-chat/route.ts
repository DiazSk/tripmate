import { NextRequest, NextResponse } from "next/server";
import { listChatTurns } from "@/lib/db";

/**
 * `GET ?tripId=` → the saved edit conversation for a trip, oldest first.
 *
 * Read-only. Turns are written by `/api/trip-edit` as part of the edit that produced them, so
 * there is no way for the transcript to record a change that never landed.
 *
 * Always 200 with a list. A trip with no conversation yet, an unsaved trip, and an id that does
 * not exist are all the same answer — an empty transcript — and none of them is something the
 * traveler can act on differently.
 */
export async function GET(req: NextRequest) {
  const tripId = req.nextUrl.searchParams.get("tripId")?.trim();
  if (!tripId) return NextResponse.json({ error: "tripId is required" }, { status: 400 });

  const turns = listChatTurns(tripId).map((t) => ({
    role: t.role,
    content: t.content,
    createdAt: t.created_at,
    // Spread back into the shape EditChatPanel's ChatMessage already renders, so a restored turn
    // is indistinguishable from a live one.
    ...(t.meta_json ? (JSON.parse(t.meta_json) as Record<string, unknown>) : {}),
  }));
  return NextResponse.json({ turns });
}
