import { DayPlan, Stop } from "@/lib/types";

function LodgingIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className="h-4 w-4 shrink-0 text-accent"
      aria-hidden="true"
    >
      <path
        d="M3 15.5V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3.5M3 15.5h14M3 15.5V12a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v3.5M7 8.5h5a2 2 0 0 1 2 2V11H7V8.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ActualCostInput({
  value,
  onCommit,
}: {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      placeholder="actual"
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        e.stopPropagation();
        onCommit(e.target.value === "" ? undefined : Number(e.target.value));
      }}
      className="w-20 rounded-md border border-card-border bg-white px-2 py-1 text-xs tabular-nums focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/25"
    />
  );
}

export type ActualCostTarget = "lodging" | number;

export default function DayList({
  days,
  onSelectStop,
  editable,
  onActualCostChange,
}: {
  days: DayPlan[];
  onSelectStop?: (stop: Stop) => void;
  editable?: boolean;
  onActualCostChange?: (dayIndex: number, target: ActualCostTarget, value: number | undefined) => void;
}) {
  return (
    <div className="space-y-4">
      {days.map((day, i) => (
        <div
          key={i}
          className="rounded-2xl border border-card-border bg-card p-5 shadow-[0_1px_2px_rgba(32,28,25,0.04),0_8px_24px_-12px_rgba(32,28,25,0.12)] sm:p-6"
        >
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <h3 className="font-display text-lg font-semibold whitespace-nowrap text-foreground">
              Day {i + 1} <span className="text-muted">· {day.date}</span>
            </h3>
            <span className="text-sm text-muted">{day.weather}</span>
          </div>
          {day.lodging && (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-xl bg-accent/5 p-3 text-sm">
              <div className="flex items-start gap-2">
                <div className="mt-0.5">
                  <LodgingIcon />
                </div>
                <div>
                  <div className="font-medium text-foreground">{day.lodging.name}</div>
                  <div className="text-muted">{day.lodging.note}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-medium tabular-nums text-foreground">${day.lodging.cost}</span>
                {editable && (
                  <ActualCostInput
                    value={day.lodging.actualCost}
                    onCommit={(value) => onActualCostChange?.(i, "lodging", value)}
                  />
                )}
              </div>
            </div>
          )}
          <ul className="divide-y divide-card-border">
            {day.stops.map((stop, j) => (
              <li
                key={j}
                onClick={() => onSelectStop?.(stop)}
                className={`flex items-start justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0 ${
                  onSelectStop ? "cursor-pointer rounded-lg transition-colors hover:bg-foreground/[0.03]" : ""
                }`}
              >
                <div>
                  <div className="font-medium text-foreground">{stop.name}</div>
                  <div className="text-muted">{stop.note}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-foreground/80">${stop.cost}</span>
                  {editable && (
                    <ActualCostInput
                      value={stop.actualCost}
                      onCommit={(value) => onActualCostChange?.(i, j, value)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
