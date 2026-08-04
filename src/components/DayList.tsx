import { DayPlan } from "@/lib/types";

export default function DayList({ days }: { days: DayPlan[] }) {
  return (
    <div className="space-y-4">
      {days.map((day, i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">
              Day {i + 1} · {day.date}
            </h3>
            <span className="text-sm text-gray-500">{day.weather}</span>
          </div>
          <ul className="space-y-2">
            {day.stops.map((stop, j) => (
              <li key={j} className="flex items-start justify-between gap-2 text-sm">
                <div>
                  <div className="font-medium text-gray-800">{stop.name}</div>
                  <div className="text-gray-500">{stop.note}</div>
                </div>
                <span className="shrink-0 text-gray-600">${stop.cost}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
