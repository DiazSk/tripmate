import { after, NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { consentOwners, consentWriteOwners } from "@/lib/analytics/consentOwners";
import { analyticsIdFor, distinctIdFromCookies } from "@/lib/analytics/ids";
import { isUuid, requestDeletion } from "@/lib/analytics/server";
import { analyticsConsent, isAccountOwnerId, setAnalyticsConsent } from "@/lib/db";
import { OWNER_COOKIE } from "@/lib/owner";
import { capFailureResponse, readJsonCapped } from "@/lib/inputLimits";
import { throttle } from "@/lib/ipThrottle";
import { limitResponse } from "@/lib/limitResponse";
import { currentOwnerId } from "@/lib/ownerRequest";

/** `consent: null` is "never answered" (show the banner), distinct from `false` (they said No). */
export async function GET(req: NextRequest) {
  const limit = throttle(req, "lookup");
  if (limit.limited) return limitResponse(limit, "lookup");
  // Per person and changed by one press, so a cached answer would show the wrong banner state.
  return NextResponse.json({ consent: analyticsConsent(await currentOwnerId()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const limit = throttle(req, "lookup");
  if (limit.limited) return limitResponse(limit, "lookup");
  const read = await readJsonCapped(req, 1024);
  if (!read.ok) return capFailureResponse(read);
  const consent = (read.value as { consent?: unknown } | null)?.consent;
  if (typeof consent !== "boolean") return NextResponse.json({ error: "consent must be true or false" }, { status: 400 });
  // A signed-in device holds two owners (the account, and the anonymous one it signed in from). A No
  // is written to both, a Yes to the request's own owner only (see `consentWriteOwners`).
  const ownerId = await currentOwnerId();
  const cookieOwner = (await cookies()).get(OWNER_COOKIE)?.value;
  const owners = consentOwners(ownerId, cookieOwner, isAccountOwnerId);
  const hadYes = owners.some((id) => analyticsConsent(id) === true);
  for (const id of consentWriteOwners(consent, ownerId, cookieOwner, isAccountOwnerId)) setAnalyticsConsent(id, consent);
  // Taking a Yes back erases the person from PostHog, under every id they were known by: the ones
  // derived from their owner ids (what a signed-in session, and the id endpoint, use) and the
  // anonymous id in PostHog's own cookie. A No that was always a No has nothing to erase.
  if (consent === false && hadYes) {
    const secret = process.env.ANALYTICS_ID_SECRET;
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    // The cookie's id is client-supplied; PostHog's anonymous ids are UUIDs, so anything else is not one of theirs.
    const fromCookie = key ? distinctIdFromCookies(req.headers.get("cookie"), key) : null;
    const ids = new Set(
      [...owners.map((id) => (secret ? analyticsIdFor(id, secret) : null)), fromCookie && isUuid(fromCookie) ? fromCookie : null].filter(
        (id): id is string => Boolean(id)
      )
    );
    try {
      after(() => Promise.all([...ids].map(requestDeletion)));
    } catch (err) {
      console.warn("[analytics] deletion not scheduled:", err instanceof Error ? err.message : err);
    }
  }
  return new NextResponse(null, { status: 204 });
}
