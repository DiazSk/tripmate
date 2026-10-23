import { NextRequest, NextResponse } from "next/server";
import { analyticsIdFor } from "@/lib/analytics/ids";
import { currentOwnerId } from "@/lib/ownerRequest";
import { throttle } from "@/lib/ipThrottle";
import { limitResponse } from "@/lib/limitResponse";

/**
 * The caller's analytics id, derived from their owner id. The owner cookie is httpOnly on purpose,
 * so the browser cannot read it and this route must never hand it back, only the HMAC of it.
 * `id: null` is "analytics is off here" (no `ANALYTICS_ID_SECRET`), an answer and not an error.
 */
export async function GET(req: NextRequest) {
  const limit = throttle(req, "lookup");
  if (limit.limited) return limitResponse(limit, "lookup");
  const secret = process.env.ANALYTICS_ID_SECRET;
  if (!secret) return NextResponse.json({ id: null });
  return NextResponse.json({ id: analyticsIdFor(await currentOwnerId(), secret) });
}
