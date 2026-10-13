import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { claimAnonymousOwner, needsOnboarding } from "@/lib/db";
import { OWNER_COOKIE } from "@/lib/owner";
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
export async function POST() {
  const owner = await currentOwner();
  if (!owner.signedIn) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const anonymous = (await cookies()).get(OWNER_COOKIE)?.value ?? "";
  const claimed = claimAnonymousOwner(anonymous, owner.id);
  return NextResponse.json({ claimed, needsOnboarding: needsOnboarding(owner.id) });
}
