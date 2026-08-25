"use client";

import { devLabel } from "@/lib/devInspector";

/** Single-select pill row — the same shape GroupTypePicker uses, generalised so the traveler
 *  profile's several one-of-N questions don't each need their own near-identical component. */
export default function ChoicePicker<T extends string>({
  name,
  options,
  selected,
  onSelect,
}: {
  name: string;
  options: { id: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" {...devLabel(`ChoicePicker.${name}`)}>
      {options.map((o) => {
        const isActive = selected === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onSelect(o.id)}
            aria-pressed={isActive}
            // `min-h-11` reaches the 44px target the same way every other pill in this app
            // does: with height, not by growing the type. These pills measured 32px tall on
            // mobile, under the project's own floor.
            className={`flex min-h-11 items-center rounded-full px-3.5 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none ${
              isActive ? "bg-accent text-accent-foreground" : "bg-white/10 text-muted hover:bg-white/15"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export const ENERGY_LEVELS = [
  { id: "high", label: "High — walk all day" },
  { id: "moderate", label: "Moderate" },
  { id: "low", label: "Low — keep it easy" },
] as const;

export const CROWD_PREFERENCES = [
  { id: "love", label: "Love the buzz" },
  { id: "mixed", label: "A bit of both" },
  { id: "avoid", label: "Avoid crowds" },
] as const;
