import { NextResponse } from "next/server";
import { getAvatar } from "@/lib/db";

/**
 * Public on purpose: it is the image behind a URL its owner chose to set, the id is a random UUID,
 * and the URL carries the version — so it is cacheable forever and a new photo is a new URL.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const avatar = getAvatar(userId);
  if (!avatar) return new NextResponse(null, { status: 404 });
  // getAvatar copies the row into a fresh Uint8Array, so the buffer is a real ArrayBuffer; the cast only narrows the type for BodyInit.
  return new NextResponse(avatar.bytes as Uint8Array<ArrayBuffer>, {
    headers: { "Content-Type": avatar.mime, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
