import { NextRequest, NextResponse } from "next/server";
import { readProfile, writeProfile } from "@/lib/db";
import { currentOwnerId } from "@/lib/ownerRequest";
import { keepHomeCity, parseProfile } from "@/lib/travelerProfile";

export async function GET() {
  return NextResponse.json({ profile: readProfile(await currentOwnerId()) });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const profile = parseProfile(body?.profile);
  if (!profile) {
    // A contract failure, not something a traveller can act on: the wizard only
    // ever sends values it rendered as choices.
    return NextResponse.json({ error: "The profile sent wasn't a valid shape." }, { status: 400 });
  }
  const ownerId = await currentOwnerId();
  writeProfile(keepHomeCity(profile, readProfile(ownerId)), ownerId);
  return NextResponse.json({ ok: true });
}
