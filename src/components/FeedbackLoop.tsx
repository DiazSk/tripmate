"use client";

import { useState } from "react";

const primaryButtonClass =
  "rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
const ghostButtonClass =
  "rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-white/10";

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

  return (
    <div className="glass-itinerary rounded-2xl p-5 sm:p-6">
      {!showFeedback ? (
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-sm font-medium text-foreground">Happy with this itinerary?</p>
          <div className="flex gap-2">
            <button onClick={() => setShowFeedback(true)} className={ghostButtonClass}>
              Give feedback
            </button>
            <button onClick={onSave} disabled={saving} className={primaryButtonClass}>
              {saving ? "Saving…" : "Save trip"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. make day 2 cheaper, add more outdoor stops"
            className="w-full rounded-xl border border-card-border bg-white/10 p-3 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowFeedback(false)} className={ghostButtonClass}>
              Cancel
            </button>
            <button
              onClick={() => {
                onRefine(feedback);
                setFeedback("");
                setShowFeedback(false);
              }}
              disabled={!feedback.trim() || refining}
              className={primaryButtonClass}
            >
              {refining ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
