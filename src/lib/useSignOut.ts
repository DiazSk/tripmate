"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { resetAfterSignOut } from "@/lib/analytics/client";

/**
 * Signing out, shared by the profile masthead and the navbar's account menu so the two can never
 * drift. `useClerk()` throws without a `ClerkProvider`, so only call this from a component that is
 * mounted when the publishable key is set (a signed-in traveller implies it is).
 *
 * `note` carries copy rows F-15/F-16 and is "" until a sign-out fails: render it in an
 * `InlineNote` that stays mounted, with `noteId` on it and `aria-describedby={noteId}` on the button.
 */
export function useSignOut(onSignedOut?: () => void) {
  const { signOut } = useClerk();
  const router = useRouter();
  const noteId = useId();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function run() {
    setBusy(true);
    setNote("");
    try {
      await signOut();
    } catch {
      // A failed sign-out leaves the traveller signed in: say so, and put the button back so they can retry.
      setBusy(false);
      setNote(
        navigator.onLine
          ? "You’re still signed in: the sign-in service didn’t answer. Press Sign out to try again."
          : "You’re offline, so you’re still signed in. Press Sign out again once you’re back online.",
      );
      return;
    }
    // The next person on this browser starts as a stranger to PostHog, not as this account.
    resetAfterSignOut();
    onSignedOut?.();
    // `refresh()` rather than a reload: every owner-scoped server component on this route and
    // the next one has to re-read, and a router cache holding the signed-in render would show
    // this traveller their trips after they asked to be signed out.
    router.refresh();
    router.push("/");
  }

  return { signOut: run, busy, note, noteId };
}
