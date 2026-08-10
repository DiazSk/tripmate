"use client";

import { Check } from "lucide-react";
import { TIERS, TierId, estimateTierTotal } from "@/lib/tiers";

// Above this multiple of the entered budget, a tier's real price is treated
// as an aspirational stretch rather than a genuine option worth the same
// visual weight as the others (e.g. luxury at 8x a $1,000 budget) — chosen so
// the typical mid-range upsell (~3x budget) still reads as a normal option.
const OVER_BUDGET_MULTIPLIER = 3;

export default function TierPicker({
  days,
  budget,
  selected,
  onSelect,
}: {
  days: number;
  budget: number;
  selected: TierId;
  onSelect: (tier: TierId) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.3fr_1fr]">
      {TIERS.map((tier) => {
        const isSelected = selected === tier.id;
        const total = estimateTierTotal(tier, days);
        const ratio = budget > 0 ? total / budget : 0;
        const overBudget = ratio > OVER_BUDGET_MULTIPLIER;
        return (
          <button
            key={tier.id}
            type="button"
            onClick={() => onSelect(tier.id)}
            aria-pressed={isSelected}
            className="group relative isolate flex h-[280px] flex-col justify-end overflow-hidden rounded-2xl text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:h-[380px]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tier.imageSrc}
              alt={tier.imageAlt}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
            <div
              className={`absolute inset-0 rounded-2xl ring-2 ring-inset transition-colors ${
                isSelected ? "ring-accent" : "ring-white/0 group-hover:ring-white/40"
              }`}
            />
            <div
              className={`absolute right-3 top-3 flex flex-col items-end gap-0.5 rounded-2xl px-3 py-1 backdrop-blur-sm ${
                overBudget ? "bg-white/10" : "bg-surface-deep/70"
              }`}
            >
              <span
                className={`text-sm ${overBudget ? "font-normal text-white/60" : "font-semibold text-white"}`}
              >
                ~${total.toLocaleString()}
              </span>
              {overBudget && (
                <span className="text-[10px] leading-none text-white/50">
                  ~{ratio.toFixed(1)}x your budget
                </span>
              )}
            </div>
            {isSelected && (
              <div className="absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Check className="h-4 w-4" />
              </div>
            )}
            <div className="relative z-10 p-4">
              <div className="font-display text-lg font-semibold text-white">{tier.headline}</div>
              <div className="mt-1 text-xs leading-relaxed text-white/80 line-clamp-3 sm:line-clamp-none">
                {tier.longDescription}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
