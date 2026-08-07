"use client";

import { useState } from "react";

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
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-5">
      {!showFeedback ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-stone-700">Happy with this itinerary?</p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFeedback(true)}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100"
            >
              Give feedback
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
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
            className="w-full rounded-lg border border-stone-300 bg-white p-2.5 text-sm text-stone-900 placeholder:text-stone-400 outline-none transition-colors focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowFeedback(false)}
              className="rounded-lg px-3 py-1.5 text-sm text-stone-600 transition-colors hover:bg-stone-100"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onRefine(feedback);
                setFeedback("");
                setShowFeedback(false);
              }}
              disabled={!feedback.trim() || refining}
              className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refining ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
