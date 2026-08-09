"use client";

import { PlaceDetail, Stop } from "@/lib/types";

export default function PlaceDetailPanel({
  stop,
  detail,
  loading,
  error,
  onBack,
  actualCost,
  onActualCostChange,
  upcomingStops,
  onSelectUpcoming,
}: {
  stop: Stop;
  detail: PlaceDetail | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  actualCost?: number;
  onActualCostChange?: (value: number | undefined) => void;
  /** Remaining stops for the same day, in order — powers the "Next Up" quick-nav list. */
  upcomingStops?: Stop[];
  onSelectUpcoming?: (stop: Stop) => void;
}) {
  return (
    <div className="glass-itinerary flex flex-col rounded-2xl p-5 sm:p-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
          <path
            d="M12 5l-5 5 5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back to itinerary
      </button>

      <h2 className="font-display text-xl font-semibold text-foreground">{stop.name}</h2>
      <p className="mt-1 text-sm text-muted">{stop.note}</p>

      <div className="mt-5 space-y-4 text-sm">
        {loading && (
          <div className="animate-pulse space-y-3">
            <div className="h-3 w-full rounded bg-foreground/10" />
            <div className="h-3 w-5/6 rounded bg-foreground/10" />
            <div className="h-3 w-2/3 rounded bg-foreground/10" />
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {detail && !loading && (
          <>
            <p className="leading-relaxed text-foreground/90">{detail.history}</p>
            <div>
              <div className="text-xs font-semibold tracking-wide text-muted uppercase">
                Best time to visit
              </div>
              <p className="mt-1 text-foreground/90">{detail.bestTime}</p>
            </div>
            <div>
              <div className="text-xs font-semibold tracking-wide text-muted uppercase">
                Suggested duration
              </div>
              <p className="mt-1 text-foreground/90">{detail.duration}</p>
            </div>
            <div>
              <div className="text-xs font-semibold tracking-wide text-muted uppercase">Tips</div>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/90">
                {detail.tips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          </>
        )}

        {onSelectUpcoming && upcomingStops && upcomingStops.length > 0 && (
          <div className="border-t border-card-border pt-4">
            <div className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
              Next up
            </div>
            <div
              className="flex gap-2 overflow-x-auto pb-1 [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]"
            >
              {upcomingStops.map((next, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelectUpcoming(next)}
                  className="shrink-0 rounded-xl border border-card-border bg-white/10 px-3 py-2 text-left transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <div className="text-sm font-medium text-foreground">{next.name}</div>
                  {(next.time || next.durationLabel) && (
                    <div className="text-xs text-muted">
                      {[next.time, next.durationLabel].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-card-border pt-4">
          <span className="font-medium tabular-nums text-foreground">
            Estimated cost: ${stop.cost}
          </span>
          {onActualCostChange && (
            <label className="flex items-center gap-2 text-xs text-muted">
              Actual
              <input
                type="number"
                min={0}
                defaultValue={actualCost}
                onBlur={(e) =>
                  onActualCostChange(e.target.value === "" ? undefined : Number(e.target.value))
                }
                className="w-20 rounded-md border border-card-border bg-white/10 px-2 py-1 text-xs tabular-nums text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/25"
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
