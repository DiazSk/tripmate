"use client";

import { useEffect, useRef, useState } from "react";
import { devLabel } from "@/lib/devInspector";

const primaryButtonClass =
  "inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
const ghostButtonClass =
  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none";

/**
 * Where the plan's automatic draft has got to. `null` means no draft is being tracked at all, so
 * the reassurance line is simply absent — the state this footer shipped in.
 */
export type DraftState = "pending" | "saved" | "failed" | null;

/**
 * The one line that tells the traveler their plan is not riding on this button.
 *
 * `Keep this trip` reads as the only thing standing between them and losing the plan, because for
 * a long time it was. It isn't any more — the itinerary is written to a draft row the moment it
 * arrives — but a silent safety net is one nobody trusts, and the traveler who presses Back is
 * exactly the traveler who never learned it was there. So the state is stated, including when it
 * fails: the failed copy points at the button, which really is the only path left in that case.
 *
 * `role="status"` rather than a bare <p>: the text changes under the traveler without them acting,
 * so a screen reader has to be told, and politely enough not to interrupt the card's own reveal.
 */
function DraftNote({ state }: { state: DraftState }) {
  if (!state) return null;
  const failed = state === "failed";
  return (
    <p
      role="status"
      className={`mt-0.5 text-xs ${failed ? "text-alert" : "text-muted"}`}
    >
      {state === "pending" && "Saving a draft…"}
      {state === "saved" && "Saved as a draft — find it under Drafts in My memories."}
      {failed && "We couldn't save a draft of this. Keep it to be sure it sticks."}
    </p>
  );
}

export default function FeedbackLoop({
  onSave,
  onRefine,
  saving,
  refining,
  draftState = null,
}: {
  onSave: () => void;
  onRefine: (feedback: string) => void;
  saving: boolean;
  refining: boolean;
  /** Optional so the preview/fixture callers that don't own a draft keep working unchanged. */
  draftState?: DraftState;
}) {
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // The prompt replaces the two buttons rather than appearing beside them, so
  // focus has to follow it — otherwise the control that opened the box is gone
  // and focus is back on <body>.
  useEffect(() => {
    if (showFeedback) fieldRef.current?.focus();
  }, [showFeedback]);

  const busy = saving || refining;

  return (
    <div className="glass-itinerary rounded-2xl p-5 sm:p-6" {...devLabel("FeedbackLoop")}>
      {!showFeedback ? (
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            {/* Was "Happy with this itinerary?" — a yes/no question whose two answers
                were "Give feedback" and "Save trip". */}
            <p className="text-sm font-medium text-foreground">This is your plan.</p>
            <DraftNote state={draftState} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowFeedback(true)}
              disabled={busy}
              className={ghostButtonClass}
            >
              Change something
            </button>
            {/* Disabled while refining too: the save used to stay live mid-refine,
                which persisted the itinerary the user was in the middle of replacing. */}
            <button type="button" onClick={onSave} disabled={busy} className={primaryButtonClass}>
              {saving ? "Keeping…" : "Keep this trip"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label htmlFor="trip-feedback" className="block text-sm font-medium text-foreground">
            What should change?
          </label>
          <textarea
            id="trip-feedback"
            ref={fieldRef}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Make day 2 cheaper, add more outdoor stops…"
            // 16px, not 14px: below that iOS Safari zooms the viewport on focus.
            className="w-full rounded-xl border border-card-border bg-white/10 p-3 text-base text-foreground placeholder:text-white/65 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowFeedback(false)}
              disabled={busy}
              className={ghostButtonClass}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onRefine(feedback);
                setFeedback("");
                setShowFeedback(false);
              }}
              disabled={!feedback.trim() || busy}
              className={primaryButtonClass}
            >
              {refining ? "Reworking…" : "Rework the plan"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
