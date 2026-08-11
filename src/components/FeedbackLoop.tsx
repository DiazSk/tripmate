"use client";

import { useEffect, useRef, useState } from "react";

const primaryButtonClass =
  "inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
const ghostButtonClass =
  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none";

export default function FeedbackLoop({
  onSave,
  onRefine,
  saving,
  refining,
}: {
  onSave: () => void;
  onRefine: (feedback: string) => void;
  saving: boolean;
  refining: boolean;
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
    <div className="glass-itinerary rounded-2xl p-5 sm:p-6">
      {!showFeedback ? (
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          {/* Was "Happy with this itinerary?" — a yes/no question whose two answers
              were "Give feedback" and "Save trip". */}
          <p className="text-sm font-medium text-foreground">This is your plan.</p>
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
