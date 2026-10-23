"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  analyticsConfigured,
  applyStoredConsent,
  CONSENT_EVENT,
  localConsent,
  readStoredConsent,
  rememberLinkParams,
  setAccount,
  setConsent,
  SIGNED_IN_EVENT,
} from "@/lib/analytics/client";
import { consentPromptVisible } from "@/lib/analytics/clientConfig";
import { notePath } from "@/lib/analytics/flow";
import ConsentPrompt from "./ConsentPrompt";

/**
 * Decides, once per page load, whether analytics may run, and mounts the prompt when nobody has
 * answered. It renders nothing without `NEXT_PUBLIC_POSTHOG_KEY`, so an unconfigured build is
 * unchanged. `analyticsConfigured` is a build-time constant, which is why the hooks can sit
 * behind a plain early return in the outer component.
 *
 * `clerk` is whether the layout mounted a `ClerkProvider` (`useUser` throws without one), and the
 * layout places this inside it. Without Clerk nobody can be signed in, so there is no account.
 */
export default function AnalyticsProvider({ clerk }: { clerk: boolean }) {
  return analyticsConfigured ? (
    <>
      {clerk && <ClerkAccount />}
      <Gate />
    </>
  ) : null;
}

/** Tells the analytics client who is signed in, so it can identify them; renders nothing. */
function ClerkAccount() {
  const { isLoaded, isSignedIn, user } = useUser();
  const id = user?.id;
  const name = user?.fullName ?? null;
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  useEffect(() => {
    if (!isLoaded) return;
    setAccount(isSignedIn && id ? { id, name, email } : null);
  }, [isLoaded, isSignedIn, id, name, email]);
  return null;
}

function Gate() {
  const pathname = usePathname();
  const [asking, setAsking] = useState(false);
  const decided = useRef(false);
  const reading = useRef(0);

  // A failed read is "no answer yet": no capture and no prompt, never a Yes. Navigation tries again.
  const decide = useCallback(() => {
    if (decided.current) return;
    rememberLinkParams();
    const run = ++reading.current;
    void readStoredConsent().then((stored) => {
      if (run !== reading.current || !stored || decided.current) return;
      decided.current = true;
      // A stored No also stops a client that is already up (see `applyStoredConsent`).
      if (stored.consent !== null) void applyStoredConsent(stored.consent);
      else if (consentPromptVisible(null, localConsent())) setAsking(true);
      // No stored answer but one this device remembers: nothing to start.
    });
  }, []);

  useEffect(decide, [decide, pathname]);
  // So a trip page can say where it was opened from; nothing is sent.
  useEffect(() => notePath(pathname), [pathname]);

  useEffect(() => {
    // Answered elsewhere (the Profile switch): the prompt has nothing left to ask.
    const answered = () => {
      reading.current++;
      decided.current = true;
      setAsking(false);
    };
    // The claim has landed: the account's owner may carry an answer the first read could not see
    // (it raced the claim), so ask again, and take back a prompt that was only the race's.
    const claimed = () => {
      decided.current = false;
      setAsking(false);
      decide();
    };
    window.addEventListener(CONSENT_EVENT, answered);
    window.addEventListener(SIGNED_IN_EVENT, claimed);
    return () => {
      window.removeEventListener(CONSENT_EVENT, answered);
      window.removeEventListener(SIGNED_IN_EVENT, claimed);
    };
  }, [decide]);

  return asking ? <ConsentPrompt onAnswer={setConsent} /> : null;
}
