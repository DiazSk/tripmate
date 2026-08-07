import { DayPlan } from "@/lib/types";
import WeatherPopover from "./WeatherPopover";
import { isIndoorRecommended } from "./WeatherIcon";

export default function DayList({
  days,
  budget,
  hoveredStop,
  onHoverStop,
}: {
  days: DayPlan[];
  budget: number;
  hoveredStop?: string | null;
  onHoverStop?: (key: string | null) => void;
}) {
  return (
    <div className="space-y-4">
      {days.map((day, i) => {
        const daySpend = day.stops.reduce((s, stop) => s + (stop.cost || 0), 0);
        const dayBudgetPct = budget > 0 ? Math.min(100, (daySpend / budget) * 100) : 0;
        const softened = isIndoorRecommended(day.weatherDetail);

        return (
          <div
            key={i}
            className={`rounded-xl border p-5 shadow-sm transition-colors ${
              softened ? "border-sky-200 bg-sky-50/50" : "border-stone-200 bg-white"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <h3 className="font-semibold text-stone-900">
                Day {i + 1} · {day.date}
              </h3>
              <WeatherPopover weather={day.weatherDetail} fallbackText={day.weather} />
            </div>

            <div className="mb-4">
              <div className="mb-1 flex items-center justify-between text-xs text-stone-500">
                <span>Day budget</span>
                <span>
                  ${daySpend.toFixed(0)} · {dayBudgetPct.toFixed(0)}% of trip budget
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
                <div
                  className="h-full rounded-full bg-orange-400 transition-all"
                  style={{ width: `${dayBudgetPct}%` }}
                />
              </div>
            </div>

            <ul className="divide-y divide-stone-100">
              {day.stops.map((stop, j) => {
                const key = `${i}-${j}`;
                return (
                  <li
                    key={j}
                    onMouseEnter={() => onHoverStop?.(key)}
                    onMouseLeave={() => onHoverStop?.(null)}
                    className={`flex items-start justify-between gap-4 rounded-md px-2 py-2.5 text-sm transition-colors first:pt-0 last:pb-0 ${
                      hoveredStop === key ? "bg-orange-50" : ""
                    }`}
                  >
                    <div>
                      <div className="font-medium text-stone-800">{stop.name}</div>
                      <div className="text-stone-500">{stop.note}</div>
                    </div>
                    <span className="shrink-0 font-medium text-stone-600">
                      ${stop.cost}
                    </span>
                  </li>
                );
              })}
            </ul>

            {day.summary && (
              <p className="mt-4 border-t border-stone-100 pt-3 text-sm italic text-stone-500">
                {day.summary}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
