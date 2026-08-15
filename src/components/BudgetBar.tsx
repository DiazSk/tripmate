import { DayPlan } from "@/lib/types";
import { devLabel } from "@/lib/devInspector";
import { tripSpend } from "@/lib/itinerary";
import { formatMoney } from "@/lib/format";

export default function BudgetBar({
  days,
  budget,
}: {
  days: DayPlan[];
  budget: number;
}) {
  const spent = tripSpend(days);
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
