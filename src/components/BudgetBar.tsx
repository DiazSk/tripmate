import { DayPlan } from "@/lib/types";
import { devLabel } from "@/lib/devInspector";

export default function BudgetBar({
  days,
  budget,
}: {
  days: DayPlan[];
  budget: number;
}) {
  const spent = days.reduce(
    (sum, day) =>
      sum +
      (day.lodging?.cost || 0) +
      day.stops.reduce((s, stop) => s + (stop.cost || 0), 0),
    0
  );
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const over = spent > budget;

  return (
    <div {...devLabel("BudgetBar")}>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">Budget</span>
        <span
          className={`tabular-nums ${over ? "font-semibold text-red-600" : "text-muted"}`}
        >
          ${spent.toFixed(0)} / ${budget.toFixed(0)}
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
    </div>
  );
}
