import { NextRequest, NextResponse } from "next/server";
import { markOnboarded } from "@/lib/db";
import { currentOwner } from "@/lib/ownerRequest";

export async function POST(req: NextRequest) {
  const owner = await currentOwner();
  if (!owner.signedIn) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // `?? {}` too: a JSON body of `null` parses fine and would otherwise throw on `.skipped`.
  const body = ((await req.json().catch(() => null)) ?? {}) as { skipped?: unknown };
  markOnboarded(owner.id, body.skipped === true);
  return NextResponse.json({ ok: true });
}
