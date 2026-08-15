"use client";

import { devLabel } from "@/lib/devInspector";
import { ExplorerStyle } from "@/lib/types";

const EXPLORER_STYLES: { id: ExplorerStyle; label: string; hint: string }[] = [
  { id: "packed", label: "Packed", hint: "4–5 stops a day, tight schedule" },
  { id: "relaxed", label: "Relaxed", hint: "2–3 stops a day, room to breathe" },
  { id: "offbeat", label: "Offbeat", hint: "Local spots over headline attractions" },
  { id: "mixed", label: "Mixed", hint: "A balance of iconic and offbeat" },
];

export default function ExplorerStylePicker({
  selected,
  onSelect,
}: {
  selected: ExplorerStyle;
  onSelect: (style: ExplorerStyle) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" {...devLabel("ExplorerStylePicker")}>
      {EXPLORER_STYLES.map((s) => {
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
            <span className={`text-xs ${isActive ? "text-accent-foreground/80" : "text-muted/70"}`}>
              {s.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
