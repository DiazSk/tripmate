import { NextResponse } from "next/server";
import { appleAppSiteAssociation } from "@/lib/appLinks";

/**
 * Apple's half of opening `/s/<token>` in the app — see `src/lib/appLinks.ts`. Served as JSON with
 * no extension and no redirect, which is what Apple's fetcher requires. 404 until `APPLE_TEAM_ID`
 * is set.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const file = appleAppSiteAssociation(process.env.APPLE_TEAM_ID);
  if (!file) return new NextResponse(null, { status: 404 });
  return NextResponse.json(file, { headers: { "Cache-Control": "public, max-age=3600" } });
}
