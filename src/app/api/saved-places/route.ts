import { NextRequest, NextResponse } from "next/server";
import { deleteSavedPlace, listSavedPlaces, upsertSavedPlaces } from "@/lib/db";
import { currentOwnerId } from "@/lib/ownerRequest";
import { isThrottled } from "@/lib/ipThrottle";
import { parseSavedPlacesBody } from "@/lib/savedPlaces";

/** The traveller's "save now, plan later" inbox. Owner-scoped like trips; see saved_places in db.ts. */

const tooMany = () => NextResponse.json({ error: "Too many requests — slow down and try again shortly." }, { status: 429 });

export async function GET(req: NextRequest) {
  if (isThrottled(req)) return tooMany();
  const rows = listSavedPlaces(await currentOwnerId());
  return NextResponse.json({
    places: rows.map((r) => ({ id: r.id, name: r.name, lat: r.lat, lng: r.lng, city: r.city, source: r.source, url: r.url, createdAt: r.created_at })),
  });
}

export async function POST(req: NextRequest) {
  if (isThrottled(req)) return tooMany();
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
  if (isThrottled(req)) return tooMany();
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !deleteSavedPlace(await currentOwnerId(), id)) {
    return NextResponse.json({ error: "That place isn't saved here." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
