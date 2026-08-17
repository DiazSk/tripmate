"use client";

import { Star } from "lucide-react";
import { devLabel } from "@/lib/devInspector";
import { MAX_STARRED_PRIORITIES } from "@/lib/userAnswers";

export const INTEREST_TAGS = [
  "Food",
  "Wellness & Fitness",
  "Culture & History",
  "Nightlife",
  "Nature & Outdoors",
  "Shopping",
  "Family-Friendly",
  "Relaxation",
  "Photography",
] as const;

/**
 * Multi-select tags, where a selected tag can additionally be starred. Starring is what actually
 * discriminates between travelers — everyone picks four or five tags, so the unstarred set
 * flattens into noise; the starred few are what drive POI weighting and day themes downstream.
 *
 * The star is a nested control inside the tag rather than a separate row, so ranking never costs
 * a second pass over the same list.
 */
export default function InterestPicker({
  selected,
  starred,
  onToggle,
  onToggleStar,
}: {
  selected: string[];
  starred: string[];
  onToggle: (tag: string) => void;
  onToggleStar: (tag: string) => void;
}) {
  const starsLeft = MAX_STARRED_PRIORITIES - starred.length;

  return (
    <div className="space-y-2" {...devLabel("InterestPicker")}>
      <div className="flex flex-wrap gap-2">
        {INTEREST_TAGS.map((tag) => {
          const isActive = selected.includes(tag);
          const rank = starred.indexOf(tag);
          const isStarred = rank !== -1;
          // A tag can only be starred once the quota has room — but an already-starred tag must
          // always stay clickable, otherwise there's no way to undo a mis-star.
          const canStar = isStarred || starsLeft > 0;

          return (
            <span
              key={tag}
              className={`inline-flex items-center rounded-full transition-colors duration-150 ${
                isActive ? "bg-accent text-accent-foreground" : "bg-white/10 text-muted hover:bg-white/15"
              }`}
            >
              <button
                type="button"
                onClick={() => onToggle(tag)}
                aria-pressed={isActive}
                className={`rounded-full py-1.5 pl-3.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none ${
                  isActive ? "" : "pr-3.5"
                }`}
              >
                {tag}
              </button>
              {isActive && (
                <button
                  type="button"
                  onClick={() => onToggleStar(tag)}
                  disabled={!canStar}
                  aria-pressed={isStarred}
                  aria-label={isStarred ? `Unstar ${tag}` : `Star ${tag} as a top priority`}
                  className="rounded-full py-1.5 pr-3 pl-1.5 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none"
                >
                  <Star
                    className="h-3.5 w-3.5"
                    strokeWidth={2.25}
                    fill={isStarred ? "currentColor" : "none"}
                  />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {/* aria-live: the quota changes as a side effect of starring, so it has to be announced. */}
      <p className="text-xs text-muted" aria-live="polite">
        {starred.length === 0
          ? `Star up to ${MAX_STARRED_PRIORITIES} that matter most — those drive the plan.`
          : `${starred.join(" > ")}${starsLeft > 0 ? ` · ${starsLeft} star${starsLeft === 1 ? "" : "s"} left` : " · top 3 set"}`}
      </p>
    </div>
  );
}
