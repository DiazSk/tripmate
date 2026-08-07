import { DayPlan } from "@/lib/types";

export default function BudgetBar({
  days,
  budget,
}: {
  days: DayPlan[];
  budget: number;
}) {
  const spent = days.reduce(
    (sum, day) => sum + day.stops.reduce((s, stop) => s + (stop.cost || 0), 0),
    0
  );
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const over = spent > budget;

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-stone-700">Budget</span>
        <span className={over ? "font-semibold text-red-600" : "font-medium text-green-700"}>
          ${spent.toFixed(0)} / ${budget.toFixed(0)}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-stone-100">
        <div
          className={`h-full rounded-full transition-all ${over ? "bg-red-500" : "bg-green-600"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
