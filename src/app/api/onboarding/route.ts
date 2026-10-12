import { NextResponse } from "next/server";
import { needsOnboarding } from "@/lib/db";
import { currentOwner } from "@/lib/ownerRequest";

export async function GET() {
  const owner = await currentOwner();
  if (!owner.signedIn) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ needed: needsOnboarding(owner.id) });
}
