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
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      {!showFeedback ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-gray-700">Happy with this itinerary?</p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFeedback(true)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Give feedback
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save trip"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. make day 2 cheaper, add more outdoor stops"
            className="w-full rounded-md border border-gray-300 p-2 text-sm"
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowFeedback(false)}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
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
              className="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {refining ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
