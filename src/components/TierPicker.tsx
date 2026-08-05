"use client";

import { TIERS, TierId, estimateTierTotal } from "@/lib/tiers";

export default function TierPicker({
  days,
  selected,
  onSelect,
}: {
  days: number;
  selected: TierId;
  onSelect: (tier: TierId) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {TIERS.map((tier) => {
        const isSelected = selected === tier.id;
        return (
          <button
            key={tier.id}
            type="button"
            onClick={() => onSelect(tier.id)}
            aria-pressed={isSelected}
            className={`rounded-xl border p-4 text-left transition-all duration-150 ${
              isSelected
                ? "border-accent bg-accent/5 shadow-[0_1px_2px_rgba(191,83,51,0.08)]"
                : "border-card-border bg-white hover:border-accent/40"
            }`}
          >
            <div className="font-display text-base font-semibold text-foreground">
              {tier.name}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-muted">{tier.description}</div>
            <div className="mt-3 text-lg font-semibold tabular-nums text-foreground">
              ~${estimateTierTotal(tier, days).toLocaleString()}
            </div>
          </button>
        );
      })}
    </div>
  );
}
