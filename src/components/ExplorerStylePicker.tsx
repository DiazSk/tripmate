"use client";

import { devLabel } from "@/lib/devInspector";
import { DiscoveryPreference, PacePreference } from "@/lib/types";

/**
 * Two pickers where there was one, and the old one's own hints are why.
 *
 * "Explorer style" offered `packed` ("4–5 stops a day, tight schedule"), `relaxed` ("2–3 stops
 * a day"), `offbeat` ("Local spots over headline attractions") and `mixed` — two of them
 * describing how full a day is and two describing what goes in it, in one single-select. A
 * packed off-the-beaten-path trip could not be asked for at all, and `offbeat` quietly set a
 * ceiling of three stops a day on the strength of an answer about taste.
 *
 * The file keeps its name so the two call sites' imports stay put; the old default export is
 * gone, because nothing should be able to ask the conflated question any more.
 */

export const PACES: { id: PacePreference; label: string; hint: string }[] = [
  { id: "relaxed", label: "Relaxed", hint: "2–3 stops a day, room to breathe" },
  { id: "balanced", label: "Balanced", hint: "4 stops a day" },
  { id: "packed", label: "Packed", hint: "4–5 stops a day, tight schedule" },
];

export const DISCOVERIES: { id: DiscoveryPreference; label: string; hint: string }[] = [
  { id: "iconic", label: "Iconic", hint: "The headline attractions" },
  { id: "local", label: "Off the beaten path", hint: "Local spots over headline attractions" },
  { id: "mix", label: "A bit of both", hint: "A balance of iconic and local" },
];

export function PacePicker({
  selected,
  onSelect,
}: {
  selected: PacePreference;
  onSelect: (pace: PacePreference) => void;
}) {
  return <Chips name="PacePicker" options={PACES} selected={selected} onSelect={onSelect} />;
}

export function DiscoveryPicker({
  selected,
  onSelect,
}: {
  selected: DiscoveryPreference;
  onSelect: (discovery: DiscoveryPreference) => void;
}) {
  return (
    <Chips name="DiscoveryPicker" options={DISCOVERIES} selected={selected} onSelect={onSelect} />
  );
}

/** The chip row both use — the same markup the one picker had, lifted rather than copied. */
function Chips<T extends string>({
  name,
  options,
  selected,
  onSelect,
}: {
  name: string;
  options: { id: T; label: string; hint: string }[];
  selected: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" {...devLabel(name)}>
      {options.map((s) => {
        const isActive = selected === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-pressed={isActive}
            className={`flex flex-col items-start gap-0.5 rounded-2xl px-3.5 py-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none ${
              isActive ? "bg-accent text-accent-foreground" : "bg-white/10 text-muted hover:bg-white/15"
            }`}
          >
            <span className="text-sm font-medium">{s.label}</span>
            <span className={`text-xs ${isActive ? "text-accent-foreground/80" : "text-muted"}`}>
              {s.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
