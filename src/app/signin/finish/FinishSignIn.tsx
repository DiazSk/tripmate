"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/lib/toast";
import { ACCOUNT_CREATED_KEY } from "@/components/AccountReceipt";
import { afterSignInPath } from "@/lib/afterSignIn";
import { safeNextPath } from "@/lib/safeNext";

/**
 * Every web sign-in ends here: claim the device's anonymous work, confirm it, route on.
 *
 * One place for five ways in — email, code, reset, Apple, Google — so the claim cannot be
 * forgotten on any of them. A failed claim is swallowed (counted as nothing moved): the traveller
 * has an account either way, which is the contract BetterAuth's hook kept.
 */
export default function FinishSignIn() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      let needsOnboarding = false;
      let claimed = 0;
      try {
        const res = await fetch("/api/account/claim", { method: "POST" });
        if (res.ok) ({ claimed, needsOnboarding } = (await res.json()) as { claimed: number; needsOnboarding: boolean });
      } catch {
        // See above.
      }
      if (needsOnboarding) sessionStorage.setItem(ACCOUNT_CREATED_KEY, String(claimed));
      else toast.show("Signed in", "Your trips and travel profile are here.");
      // `refresh()` before navigating: `/trips` and `/profile` read the owner at render time, and
      // the router cache still holds their signed-out render.
      router.refresh();
      router.replace(afterSignInPath({ needsOnboarding, next: safeNextPath(params.get("next")) }));
    })();
  }, [params, router, toast]);

  return <main className="min-h-full px-5 pt-[calc(var(--nav-h)+1.25rem)] text-sm text-muted">One moment…</main>;
}
