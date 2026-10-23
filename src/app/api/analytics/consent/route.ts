import { NextRequest, NextResponse } from "next/server";
import { analyticsConsent, setAnalyticsConsent } from "@/lib/db";
import { capFailureResponse, readJsonCapped } from "@/lib/inputLimits";
import { throttle } from "@/lib/ipThrottle";
import { limitResponse } from "@/lib/limitResponse";
import { currentOwnerId } from "@/lib/ownerRequest";

/** `consent: null` is "never answered" (show the banner), distinct from `false` (they said No). */
export async function GET(req: NextRequest) {
  const limit = throttle(req, "lookup");
  if (limit.limited) return limitResponse(limit, "lookup");
  return NextResponse.json({ consent: analyticsConsent(await currentOwnerId()) });
}

export async function POST(req: NextRequest) {
  const limit = throttle(req, "lookup");
  if (limit.limited) return limitResponse(limit, "lookup");
  const read = await readJsonCapped(req, 1024);
  if (!read.ok) return capFailureResponse(read);
  const consent = (read.value as { consent?: unknown } | null)?.consent;
  if (typeof consent !== "boolean") return NextResponse.json({ error: "consent must be true or false" }, { status: 400 });
  setAnalyticsConsent(await currentOwnerId(), consent);
  return new NextResponse(null, { status: 204 });
}
