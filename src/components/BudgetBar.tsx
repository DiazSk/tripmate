"use client";

import { useState } from "react";

import { DayPlan } from "@/lib/types";
import { devLabel } from "@/lib/devInspector";
import { budgetSegments, tripSpend } from "@/lib/itinerary";
import { formatMoney } from "@/lib/format";

/**
 * Spent against budget, cut into one span per day.
 *
 * **What the split adds, and why it is not decoration.** The bar said how much and never when.
 * `ItineraryCard` already breaks a *single* day into Food / Entry / Transit / Other / Stay, so
 * composition is told; what nothing anywhere showed was how spend is distributed across the trip —
 * which is exactly the question the rebalance flow exists to answer, since it triggers on one day
 * running over its plan. In the same strip of pixels a reader can now see which day is eating the
 * budget, and over budget, which day it ran out on.
 *
 * **Why the fill is gold, which is the question this bar has already answered once.** It used to
 * fill in `--accent`, back when that was the single amber painting 55 elements on one screen of
 * `/trip/[id]` — the primary button, the "DAY 1 OF 3" label, this fill, the download control and
 * the selected day tab. There was no way to tell an action from a readout, so a *healthy* budget at
 * 90% rendered as a nearly-full bar in the please-click-me colour and read as an alarm. Gold counts,
 * and `--money`'s own definition is the rule: a figure is information, not an invitation, so it
 * never borrows the action colour. Nothing about this fill means "warning" — over budget it becomes
 * `--alert` and says so in words underneath.
 *
 * **And why the days are not colour-coded.** Hue encodes categories that have no natural order;
 * days have both an order and a position, and they are already laid left to right in sequence. Two
 * concrete reasons beyond the rule. `MAX_TRIP_DAYS` is 30, and there is no thirty-hue palette that
 * stays distinguishable — any scheme cycles, and a cycling palette means day 1 and day 8 share a
 * colour, which is worse than none. And the per-day breakdown further down this same card *is*
 * categorical (Food / Entry / Transit / Other / Stay), so a multi-coloured bar directly above it
 * would invite exactly the wrong reading: that the colours are those categories. Separation is the
 * one slate at an alpha instead — a hairline of the panel's own material, plus an alternating
 * lightness step so adjacent days stay legible where a 30-day trip makes the spans narrow. The
 * precedent is the destination map's three layers, separated purely by alpha of one token.
 *
 * **The arithmetic is not here.** `budgetSegments` lives in `lib/itinerary.ts` beside the other
 * money functions, because that file's docblock records three independent summations that once
 * disagreed on screen, and because `npm test` can only reach pure modules — arithmetic inside a
 * component is arithmetic nothing checks.
 */
export default function BudgetBar({
  days,
  budget,
  activeDayIndex,
}: {
  days: DayPlan[];
  budget: number;
  /** Highlights the day being read, so the bar and the day tabs point at the same thing. Optional
   *  because `SplitEditor` has an "All Days" mode where `null` is the correct answer. Deliberately
   *  a *readout* — the tabs already own day selection, and making thirty spans clickable would
   *  duplicate navigation while adding thirty tab stops to a panel whose job is reading. */
  activeDayIndex?: number | null;
}) {
  const spent = tripSpend(days);
  const hasBudget = budget > 0;
  const over = hasBudget && spent > budget;
  const segments = budgetSegments(days, budget);

  /** The day under the pointer. Held here so there is one tip element rather than thirty hidden
   *  ones — the same trade `DestinationMap` makes for its eighty-seven marks. */
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const tip = segments.find((s) => s.dayIndex === hoveredDay) ?? null;

  return (
    <div {...devLabel("BudgetBar")}>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-foreground">Budget</span>
        {/* The figure in the money face and the money colour, the target beside it in muted text.
            It used to be muted-on-plan and alert-over, which said nothing at all in the ordinary
            case — the number a traveller checks most often was the same weight as the label next
            to it. */}
        <span className={`font-mono tabular-nums ${over ? "font-semibold text-alert" : "text-money"}`}>
          {formatMoney(spent)}
          <span className="font-sans text-muted"> / {hasBudget ? formatMoney(budget) : "no budget set"}</span>
        </span>
      </div>

      <div className="relative">
        {tip && (
          // Which side it leaves on is picked from the anchor, because the panel body scrolls
          // vertically — which computes `overflow-x` to non-visible — so a centred tip on the
          // first or last day would be clipped. Same three cases the map's tip uses.
          <span
            aria-hidden
            className={`budget-tip is-${tip.left + tip.width / 2 > 88 ? "end" : tip.left + tip.width / 2 < 12 ? "start" : "center"}`}
            style={{ left: `${tip.left + tip.width / 2}%` }}
          >
            Day {tip.dayIndex + 1} · {formatMoney(tip.spend)}
          </span>
        )}

        {/* `aria-hidden`, and that is the considered answer rather than an omission. Every figure
            this bar draws is already text in reading order immediately around it — the total sits
            directly above and the overage directly below — so a role and a label here would
            re-announce two numbers and add none. Thirty tab stops between the budget line and the
            day tabs would be a worse surface for exactly the people it claimed to serve.

            One delegated listener for up to thirty spans, not thirty listeners. */}
        <div
          aria-hidden
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-foreground/[0.06]"
          onPointerOver={(e) => {
            const el = (e.target as HTMLElement).closest<HTMLElement>("[data-day]");
            setHoveredDay(el ? Number(el.dataset.day) : null);
          }}
          onPointerLeave={() => setHoveredDay(null)}
        >
          {segments.map((segment) => (
            <div
              key={segment.dayIndex}
              data-day={segment.dayIndex}
              // Parity comes from the day, not from the position in this array: a dropped
              // zero-spend day would otherwise flip the stripe for every day after it, so the
              // pattern would change depending on which days happened to cost nothing.
              className={`budget-seg${segment.dayIndex % 2 === 1 ? " is-alt" : ""}${
                segment.dayIndex === activeDayIndex ? " is-active" : ""
              }${over ? " is-over" : ""}`}
              // Width is the only thing the call site sets, because it is data. Everything visual
              // lives in globals.css — an inline `background` here would silently beat the hover
              // and active rules, which is this project's most-repeated trap.
              style={{ width: `${segment.width}%` }}
            />
          ))}
        </div>
      </div>

      {/* The bar can only ever fill to 100%, so how far past the budget you are has
          to be said rather than drawn — and it carries the word "over", because red
          fill alone is colour as the sole signal. */}
      {over && (
        <p className="mt-2 text-xs font-medium text-alert">
          <span className="tabular-nums">{formatMoney(spent - budget)}</span> over budget
        </p>
      )}
    </div>
  );
}
