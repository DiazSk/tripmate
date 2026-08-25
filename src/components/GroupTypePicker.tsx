"use client";

import { devLabel } from "@/lib/devInspector";
import { GroupType } from "@/lib/types";

const GROUP_TYPES: { id: GroupType; label: string }[] = [
  { id: "solo", label: "Solo" },
  { id: "couple", label: "Couple" },
  { id: "family_with_kids", label: "Family with kids" },
  // Three pills covered three trips. Five friends, a work offsite and three generations all had
  // to pick the least wrong one, and the plan was built on that wrong answer.
  { id: "other", label: "Other" },
];

export default function GroupTypePicker({
  selected,
  onSelect,
}: {
  selected: GroupType;
  onSelect: (group: GroupType) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" {...devLabel("GroupTypePicker")}>
      {GROUP_TYPES.map((g) => {
        const isActive = selected === g.id;
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onSelect(g.id)}
            aria-pressed={isActive}
            // 44px floor, reached with height rather than by growing the type — same fix as
            // ChoicePicker, which this component predates and duplicates.
            className={`flex min-h-11 items-center rounded-full px-3.5 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none ${
              isActive ? "bg-accent text-accent-foreground" : "bg-white/10 text-muted hover:bg-white/15"
            }`}
          >
            {g.label}
          </button>
        );
      })}
    </div>
  );
}
