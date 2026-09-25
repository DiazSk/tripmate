"use client";

import { anchorCoverage } from "@/lib/guardrails";
import type { Itinerary } from "@/lib/types";

/** Shared by every "Fit it anyway" call site — both open the chat editor pre-filled with this,
 *  never auto-sent. */
export const fitMessage = (name: string) =>
  `Please fit ${name} into the plan. It matters to us; drop or move something else to make room, and tell me what you changed.`;

/**
 * "11 of your 12 places are in the plan" — the promise the import step made, kept in writing.
 * Computed from the plan itself (anchorCoverage), never from what the model claimed.
 */
export default function AnchorReceipt({
  itinerary,
  onFitAnchor,
}: {
  itinerary: Itinerary;
  /** Absent where the plan can't be regenerated (saved-trip views): the button is then hidden. */
  onFitAnchor?: (name: string) => void;
}) {
  const cov = anchorCoverage(itinerary);
  if (!cov) return null;
  const notIn = [
    ...cov.unplaced,
    ...cov.missing.map((name) => ({ name, reason: "Left out without a reason." })),
  ];
  return (
    <section aria-label="Your places" className="mb-3 rounded-xl bg-[var(--surface-deep)]/60 px-3 py-2 text-sm">
      <p className="font-medium">
        {cov.placed.length} of your {cov.total} must-see {cov.total === 1 ? "place is" : "places are"} in the plan.
      </p>
      {notIn.length > 0 && (
        <ul className="mt-1 space-y-1 text-muted">
          {notIn.map((u) => (
            <li key={u.name} className="flex items-baseline justify-between gap-3">
              <span>
                <span className="text-foreground">{u.name}</span>: {u.reason}
              </span>
              {onFitAnchor && (
                <button type="button" className="shrink-0 text-accent underline-offset-2 hover:underline" onClick={() => onFitAnchor(u.name)}>
                  Fit it anyway
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
