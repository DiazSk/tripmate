"use client";

import type { DietaryNeeds } from "@/lib/travelerProfile";

/** Fixed chips covering the restrictions that actually change which food stops fit. The
 *  free-text note is for everything else — the list is deliberately short rather than an
 *  attempt to enumerate every diet. */
export const DIETARY_TAGS = [
  "Vegetarian",
  "Vegan",
  "Pescatarian",
  "Halal",
  "Kosher",
  "Gluten-free",
  "Dairy-free",
  "Nut allergy",
] as const;

export default function DietaryPicker({
  value,
  onChange,
}: {
  value: DietaryNeeds;
  onChange: (next: DietaryNeeds) => void;
}) {
  const toggle = (tag: string) => {
    const tags = value.tags.includes(tag)
      ? value.tags.filter((t) => t !== tag)
      : [...value.tags, tag];
    onChange({ ...value, tags });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {DIETARY_TAGS.map((tag) => {
          const on = value.tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(tag)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                on
                  ? "bg-accent text-accent-foreground"
                  : "bg-white/10 text-foreground hover:bg-white/20"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={value.note}
        onChange={(e) => onChange({ ...value, note: e.target.value })}
        placeholder="Anything else — e.g. no shellfish, low salt"
        className="w-full rounded-full bg-white/10 px-3.5 py-2 text-sm text-foreground placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      />
    </div>
  );
}
