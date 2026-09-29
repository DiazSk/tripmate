import { NextRequest, NextResponse } from "next/server";
import { deleteSavedPlace, listSavedPlaces, upsertSavedPlaces } from "@/lib/db";
import { currentOwner, currentOwnerId } from "@/lib/ownerRequest";
import { parseSavedPlacesBody } from "@/lib/savedPlaces";

/** The traveller's "save now, plan later" inbox. Owner-scoped like trips; see saved_places in db.ts.
 *  No ipThrottle: its per-IP bucket is shared with the model routes and sized for them; this route is cheap and owner-scoped. */

export async function GET() {
  const { id: ownerId, signedIn } = await currentOwner();
  const rows = listSavedPlaces(ownerId, signedIn);
  return NextResponse.json({
    places: rows.map((r) => ({ id: r.id, name: r.name, lat: r.lat, lng: r.lng, city: r.city, source: r.source, url: r.url, createdAt: r.created_at })),
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = parseSavedPlacesBody(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return NextResponse.json({ saved: upsertSavedPlaces(await currentOwnerId(), parsed.rows) });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const { id: ownerId } = await currentOwner();
  if (!id || !deleteSavedPlace(ownerId, id)) {
    return NextResponse.json({ error: "That place isn't saved here." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
