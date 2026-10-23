import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { analyticsIdFor, isInternalUser } from "@/lib/analytics/ids";
import { clerkConfigured } from "@/lib/clerkConfig";
import { currentOwnerId } from "@/lib/ownerRequest";
import { throttle } from "@/lib/ipThrottle";
import { limitResponse } from "@/lib/limitResponse";

/**
 * The caller's analytics id, derived from their owner id. The owner cookie is httpOnly on purpose,
 * so the browser cannot read it and this route must never hand it back, only the HMAC of it.
 * `id: null` is "analytics is off here" (no `ANALYTICS_ID_SECRET`), an answer and not an error.
 * `internal` is whether the signed-in caller is on the team's allowlist, so the client can mark the
 * person and dashboards can filter them out; the allowlist itself never leaves the server.
 */
export async function GET(req: NextRequest) {
  const limit = throttle(req, "lookup");
  if (limit.limited) return limitResponse(limit, "lookup");
  const secret = process.env.ANALYTICS_ID_SECRET;
  // Per caller, so it must never be cached and served to someone else.
  const headers = { "Cache-Control": "no-store" };
  if (!secret) return NextResponse.json({ id: null, internal: false }, { headers });
  const clerkUserId = clerkConfigured() ? (await auth()).userId : null;
  return NextResponse.json(
    { id: analyticsIdFor(await currentOwnerId(), secret), internal: isInternalUser(clerkUserId, process.env.ANALYTICS_INTERNAL_USER_IDS) },
    { headers }
  );
}
