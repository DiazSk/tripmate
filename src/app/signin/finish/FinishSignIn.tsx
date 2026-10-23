"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/lib/toast";
import { ACCOUNT_CREATED_KEY } from "@/components/AccountReceipt";
import { afterSignInPath } from "@/lib/afterSignIn";
import { safeNextPath } from "@/lib/safeNext";
import { identifyAfterSignIn, track } from "@/lib/analytics/client";

/** The sign-in methods the form and the SSO callback name in the URL; anything else is not reported. */
const METHODS = ["email_code", "password", "google", "apple"];

type Claim = { ok: true; claimed: number; needsOnboarding: boolean } | { ok: false; unauthorized: boolean };

/** Moves what this browser made while signed out onto the account. Never throws. */
async function postClaim(): Promise<Claim> {
  try {
    const res = await fetch("/api/account/claim", { method: "POST" });
    if (res.ok) return { ok: true, ...((await res.json()) as { claimed: number; needsOnboarding: boolean }) };
    console.warn(`account claim failed: ${res.status}`);
    return { ok: false, unauthorized: res.status === 401 };
  } catch (err) {
    console.warn("account claim failed", err);
    return { ok: false, unauthorized: false };
  }
}

/**
 * Every web sign-in ends here: claim the device's anonymous work, confirm it, route on.
 *
 * One place for five ways in — email, code, reset, Apple, Google — so the claim cannot be
 * forgotten on any of them. A 401 means Clerk signed them in but this server sees no account for
 * the session (keys missing or mismatched); "Signed in" would be a lie, so that one goes back to
 * `/signin` with the reason (copy row S-05). Any other failed claim leaves the traveller with an
 * account and the trips they made before signing in still on the anonymous owner, so the "Signed in"
 * toast is replaced by one that says so and re-posts the claim (S-15), rather than a console line
 * nobody reads.
 */
export default function FinishSignIn() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const ran = useRef(false);
  const reported = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    /** Where a claim leaves the traveller; shared by the first attempt and a retry from the toast. */
    const settle = (claim: Claim, retried: boolean) => {
      // Once, whichever attempt's claim lands first: the first try, or "Try again" after it failed.
      if (claim.ok && !reported.current) {
        reported.current = true;
        // After the claim, so the id is the account's owner; unawaited, because analytics never holds a screen.
        void identifyAfterSignIn();
        // How they came in is only known to the form (or the provider's redirect), so it rides the URL.
        const method = params.get("method");
        if (method && METHODS.includes(method)) {
          // A first account is a sign-up whichever way it was made; the form's own word wins when it has one.
          const up = params.get("kind") === "up" || (params.get("kind") === null && claim.needsOnboarding);
          track(up ? "sign_up_completed" : "sign_in_completed", { method });
        }
      }
      if (!claim.ok) {
        // A 401 is the same account problem whether it came first or on a retry (S-05).
        if (claim.unauthorized) return router.replace("/signin?error=account");
        unclaimed();
        if (retried) return;
      }
      const needsOnboarding = claim.ok && claim.needsOnboarding;
      if (claim.ok && needsOnboarding) sessionStorage.setItem(ACCOUNT_CREATED_KEY, String(claim.claimed));
      else if (claim.ok) toast.show("Signed in", "Your trips and travel profile are here.");
      // `refresh()` before navigating: `/trips` and `/profile` read the owner at render time, and
      // the router cache still holds their signed-out render.
      router.refresh();
      if (!retried || needsOnboarding) {
        router.replace(afterSignInPath({ needsOnboarding, next: safeNextPath(params.get("next")) }));
      }
    };
    /** The claim did not land: say so, and let "Try again" post it again. */
    const unclaimed = () =>
      toast.showError({
        code: "S-15",
        title: "You’re signed in, but the trips you made before signing in haven’t moved to your account yet.",
        action: { label: "Try again", onClick: async () => settle(await postClaim(), true) },
      });
    void postClaim().then((claim) => settle(claim, false));
  }, [params, router, toast]);

  return <main className="min-h-full px-5 pt-[calc(var(--nav-h)+1.25rem)] text-sm text-muted">One moment…</main>;
}
