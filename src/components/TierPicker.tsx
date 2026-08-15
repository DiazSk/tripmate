"use client";

import { Check } from "lucide-react";
import { TIERS, TierId, estimateTierTotal } from "@/lib/tiers";
import { devLabel } from "@/lib/devInspector";

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
  /** Null until both trip dates are set. `tripDays` floors at 1, so computing a total from
   *  a half-filled form would show a plausible-but-wrong number ($70 / $150 / $350); the
   *  cards fall back to each tier's per-day rate, which is true whatever the dates are. */
  days: number | null;
  budget: number;
  selected: TierId;
  onSelect: (tier: TierId) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" {...devLabel("TierPicker")}>
      {TIERS.map((tier, i) => {
        const isSelected = selected === tier.id;
        const total = days === null ? null : estimateTierTotal(tier, days);
        const ratio = total !== null && budget > 0 ? total / budget : 0;
        // A per-day rate can't be over a whole-trip budget, so this stays false until the
        // dates land and `total` becomes a real number.
        const overBudget = ratio > OVER_BUDGET_MULTIPLIER;
        const priceLabel =
          total === null ? `$${tier.dailyRate}/day` : `~$${total.toLocaleString()}`;
        return (
          <button
            key={tier.id}
            type="button"
            onClick={() => onSelect(tier.id)}
            aria-pressed={isSelected}
            // Fans in after the console's cells and the section heading, continuing the same
            // stagger rather than starting a second one.
            style={{ animationDelay: `${360 + i * 70}ms` }}
            className="value-in group relative isolate flex h-[200px] flex-col justify-end overflow-hidden rounded-2xl text-left transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none"
          >
            {/* Selection holds the same scale hover reaches, so picking a card lands where
                pointing at it was already going — one movement, not two competing ones. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tier.imageSrc}
              alt={tier.imageAlt}
              className={`absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-105 ${
                isSelected ? "scale-105" : ""
              }`}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
            <div
              className={`absolute inset-0 rounded-2xl ring-2 ring-inset transition-colors duration-300 ${
                isSelected ? "ring-accent" : "ring-white/0 group-hover:ring-white/40"
              }`}
            />
            {/* The over-budget mute is weight and text alpha only — the badge keeps its slate
                backing either way. Dropping to bg-white/10 put the price, which is data, near
                2:1 over the card's bright illustration, and live repricing as the budget field
                changes means this state is now reachable mid-keystroke. */}
            <div className="absolute top-3 right-3 flex flex-col items-end gap-0.5 rounded-2xl bg-surface-deep/85 px-3 py-1 backdrop-blur-sm">
              {/* Keyed on the text so a re-price remounts the span and replays `value-in`.
                  React would otherwise reuse the node and the figure would swap with no
                  acknowledgement at all — and this figure now changes mid-keystroke. */}
              <span
                key={priceLabel}
                className={`value-in text-sm tabular-nums ${overBudget ? "font-normal text-white/80" : "font-semibold text-white"}`}
              >
                {priceLabel}
              </span>
              {overBudget && (
                // text-xs, not the 10px this used to be: 10px is off the type ramp entirely
                // and this line is the explanation for a muted price, so it has to be read.
                <span className="text-xs leading-none tabular-nums text-white/70">
                  ~{ratio.toFixed(1)}x your budget
                </span>
              )}
            </div>
            {isSelected && (
              <div className="pop-in absolute top-3 left-3 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Check className="h-4 w-4" strokeWidth={2.5} />
              </div>
            )}
            <div className="relative z-10 p-3">
              <div className="font-display text-base font-semibold text-white">{tier.headline}</div>
              {/* `description`, not `longDescription` — the short line was written for exactly
                  this size, and the card is 200px tall now that it sits under the form rather
                  than owning its own step. */}
              <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/80">
                {tier.description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
