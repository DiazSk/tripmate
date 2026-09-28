"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

/** Where the sign-up flow leaves word that an account was just made. */
export const ACCOUNT_CREATED_KEY = "tripmate:account-created";

/**
 * The promise sign-up made, kept in writing.
 *
 * **Persistent and dismissible rather than a toast, and the split is the point.** A toast is for
 * "things the traveler just did, where the result is off screen" — which fits signing *in*, an
 * ordinary act whose only news is that you are back. Creating an account happens once, and it
 * quietly moves everything this browser made onto it (`claimAnonymousOwner`). That is the single
 * most consequential thing the feature does and it is completely invisible; a confirmation you can
 * blink past is the wrong instrument for it. Same shape as `AnchorReceipt`, for the same reason.
 *
 * Read from `sessionStorage` and cleared on mount, so it shows exactly once — a reload is not a
 * second account. `role="status"` rather than `alert`: it is good news, and it must not interrupt.
 */
export default function AccountReceipt() {
  const [claimed, setClaimed] = useState<number | null>(null);
  const [gone, setGone] = useState(false);

  // A lazy `useState(() => …)` initializer is the usual fix for "read a real value before first
  // paint" and is not safe here, for the same reason `useInstallPrompt` records: this renders once
  // on the server, where `sessionStorage` does not exist, and once on the client for hydration,
  // which must match. Reading in the initializer would make the two diverge.
  /* eslint-disable react-hooks/set-state-in-effect -- see the note above */
  useEffect(() => {
    const raw = sessionStorage.getItem(ACCOUNT_CREATED_KEY);
    if (raw === null) return;
    // Cleared on read, so a refresh is not a second account.
    sessionStorage.removeItem(ACCOUNT_CREATED_KEY);
    const n = Number(raw);
    setClaimed(Number.isFinite(n) ? n : 0);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (claimed === null || gone) return null;

  return (
    <div
      role="status"
      className="value-in flex items-start gap-3 rounded-lg border border-card-border bg-[rgb(var(--surface-deep-rgb)/0.62)] px-4 py-4"
    >
      {/* The same mark the toast draws, from the same icon set — a "✓" character would be a glyph
          standing in for an icon, and would sit off the type ramp at the size it needs. */}
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">Your account is ready</p>
        <ul className="list-disc pt-1.5 pl-4 text-sm leading-relaxed text-muted">
          {/* The count is the news. Zero is still worth saying — it tells a traveller who signed
              up on a fresh browser that nothing was lost, rather than leaving them to wonder. */}
          <li>
            {claimed > 0
              ? `${claimed} ${claimed === 1 ? "trip" : "trips"} made on this browser moved across`
              : "Anything you plan from here is saved to it"}
          </li>
          <li>Your travel profile came with them</li>
          <li>Sign in on any device to find them</li>
        </ul>
      </div>
      <button
        type="button"
        onClick={() => setGone(true)}
        aria-label="Dismiss"
        className="-m-1.5 shrink-0 p-1.5 text-muted transition-colors hover:text-foreground"
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  );
}
