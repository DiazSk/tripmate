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
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">Budget</span>
        <span className={over ? "font-semibold text-red-600" : "text-gray-600"}>
          ${spent.toFixed(0)} / ${budget.toFixed(0)}
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full ${over ? "bg-red-500" : "bg-orange-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
