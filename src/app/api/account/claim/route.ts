import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { claimAnonymousOwner, isAccountOwnerId, moveAnalyticsConsent, needsOnboarding } from "@/lib/db";
import { OWNER_COOKIE } from "@/lib/owner";
import { deviceOwner } from "@/lib/analytics/consentOwners";
import { captureServer, whoFromRequest } from "@/lib/analytics/server";
import { currentOwner } from "@/lib/ownerRequest";

/**
 * Moves what this device made signed out onto the account, and says whether the welcome is due.
 *
 * Both clients call it after every successful sign-in or sign-up, by any method — the job
 * BetterAuth's `session.create.after` hook used to do in-process. The anonymous id comes from the
 * owner cookie, which `proxy.ts` also fills from the phone's `X-TripMate-Owner` header.
 * `claimAnonymousOwner` refuses the legacy bucket, self-claims and malformed ids, so a second call
 * moves nothing and still answers 200.
 */
export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner.signedIn) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const anonymous = (await cookies()).get(OWNER_COOKIE)?.value ?? "";
  const claimed = claimAnonymousOwner(anonymous, owner.id);
  // The analytics answer moves with the work: what this device said before signing in becomes the
  // account's (unless the account already answered, which stands) and the anonymous row is removed,
  // so signing out cannot bring back a Yes the account has since taken back.
  const device = deviceOwner(anonymous, owner.id, isAccountOwnerId);
  if (device) moveAnalyticsConsent(device, owner.id);
  if (claimed > 0) captureServer(await whoFromRequest(req), "trips_claimed", { count: claimed });
  return NextResponse.json({ claimed, needsOnboarding: needsOnboarding(owner.id) });
}
