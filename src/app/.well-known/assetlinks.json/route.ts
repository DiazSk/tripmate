import { NextResponse } from "next/server";
import { assetLinks } from "@/lib/appLinks";

/**
 * Android's half of opening `/s/<token>` in the app — see `src/lib/appLinks.ts`. 404 until
 * `ANDROID_CERT_SHA256` is set.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const file = assetLinks(process.env.ANDROID_CERT_SHA256);
  if (!file) return new NextResponse(null, { status: 404 });
  return NextResponse.json(file, { headers: { "Cache-Control": "public, max-age=3600" } });
}
