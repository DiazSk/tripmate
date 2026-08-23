import { DayPlan } from "@/lib/types";
import { devLabel } from "@/lib/devInspector";
import { tripSpend } from "@/lib/itinerary";
import { formatMoney } from "@/lib/format";

export default function BudgetBar({
  days,
  budget,
  flightCostUsd,
}: {
  days: DayPlan[];
  budget: number;
  /** Real airfare already deducted from the budget the plan was written against. Absent on trips
   *  with no origin and on itineraries saved before it was collected — in which case this renders
   *  exactly as it always did. */
  flightCostUsd?: number;
}) {
  const planned = tripSpend(days);
  // Added here rather than inside `tripSpend`: flights are a trip-level cost and that helper is
  // the top of a strictly per-day chain (see the contract docblock in itinerary.ts). Folding them
  // in would break the day-sums-to-trip arithmetic the print page is built on, so the flight is
  // stated as its own term instead — which is also the honest reading, since no day "spent" it.
  const flights = flightCostUsd ?? 0;
  const spent = planned + flights;
  const hasBudget = budget > 0;
  const over = hasBudget && spent > budget;
  // Clamped for the fill, unclamped for the label: 300% over used to look
  // identical to exactly on budget, so the overage is stated in words instead.
  const pct = hasBudget ? Math.min(100, (spent / budget) * 100) : 0;

  return (
    <div {...devLabel("BudgetBar")}>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-foreground">Budget</span>
        <span className={`tabular-nums ${over ? "font-semibold text-red-400" : "text-muted"}`}>
          {formatMoney(spent)}
          <span className="text-muted"> / {hasBudget ? formatMoney(budget) : "no budget set"}</span>
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-out ${
            over ? "bg-red-500" : "bg-accent"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Without this the total is unexplainable: the plan is written against the budget MINUS
          real airfare, so a $1,600 trip would show $826 of stops against $1,600 with the missing
          $728 accounted for nowhere. Names both terms rather than only the sum, because the
          question a traveler asks here is "where did the rest go". */}
      {flights > 0 && (
        <p className="mt-2 text-xs text-muted">
          <span className="tabular-nums">{formatMoney(planned)}</span> planned +{" "}
          <span className="tabular-nums">{formatMoney(flights)}</span> flights
        </p>
      )}
      {/* The bar can only ever fill to 100%, so how far past the budget you are has
          to be said rather than drawn — and it carries the word "over", because red
          fill alone is colour as the sole signal. */}
      {over && (
        <p className="mt-2 text-xs font-medium text-red-400">
          <span className="tabular-nums">{formatMoney(spent - budget)}</span> over budget
        </p>
      )}
    </div>
  );
}
