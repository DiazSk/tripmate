import { NextRequest, NextResponse } from "next/server";
import { parseAvatarUpload } from "@/lib/avatar";
import { deleteAvatar, putAvatar } from "@/lib/db";
import { currentOwner } from "@/lib/ownerRequest";

/** Photos belong to accounts. An anonymous visitor has nothing to attach one to that would survive a cleared cookie. */
async function signedInId(): Promise<string | null> {
  const owner = await currentOwner();
  return owner.signedIn ? owner.id : null;
}

export async function PUT(req: NextRequest) {
  const userId = await signedInId();
  if (!userId) return NextResponse.json({ error: "Sign in to add a photo." }, { status: 401 });
  const parsed = parseAvatarUpload(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return NextResponse.json({ image: putAvatar(userId, parsed.bytes, parsed.mime) });
}

export async function DELETE() {
  const userId = await signedInId();
  if (!userId) return NextResponse.json({ error: "Sign in to change your photo." }, { status: 401 });
  deleteAvatar(userId);
  return NextResponse.json({ image: null });
}
