"use client";

import { DayPlan, Stop } from "@/lib/types";
import { devLabel } from "@/lib/devInspector";

/** Stops that appeared/changed on the last AI turn, so the preview shows *what moved* rather than
 *  silently redrawing. Keyed by name because indices shift when a stop is inserted or removed. */
export type ChangedStops = Set<string>;

function TimelineRow({ stop, changed, isLast }: { stop: Stop; changed: boolean; isLast: boolean }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* Rail: a dot per stop with the connector drawn behind it, so the column reads as one
          continuous line rather than a stack of separate cards. */}
      <div className="relative flex w-4 shrink-0 justify-center pt-1.5">
        {!isLast && <span aria-hidden className="absolute top-4 bottom-[-1rem] w-px bg-white/15" />}
        <span
          className={`relative z-10 h-2.5 w-2.5 rounded-full ring-4 ring-[color:var(--surface-deep,#0f172a)] ${
            changed ? "bg-accent" : "bg-white/35"
          }`}
        />
      </div>

      <div
        className={`min-w-0 flex-1 rounded-lg px-2.5 py-1.5 transition-colors duration-500 ${
          changed ? "bg-accent/10" : ""
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">{stop.name}</span>
          {changed && (
            <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
              updated
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {[stop.time, stop.durationLabel].filter(Boolean).join(" · ")}
        </div>
        {stop.why && <p className="mt-1 text-xs leading-relaxed text-foreground/75">{stop.why}</p>}
      </div>
    </li>
  );
}

/**
 * Focus Mode's right pane: one day, as a plain vertical timeline.
 *
 * Deliberately not `StopList` — that carries photos, edit pencils, budget rows and click-through
 * to the map detail panel, all of which compete with the chat for attention. The preview's only
 * job is to answer "what does the day look like now?".
 */
export default function DayTimeline({
  day,
  dayIndex,
  changed,
  busy,
}: {
  day: DayPlan;
  dayIndex: number;
  changed: ChangedStops;
  busy?: boolean;
}) {
  return (
    <div
      className={`h-full overflow-y-auto px-4 py-3 transition-opacity duration-200 ${busy ? "opacity-60" : ""}`}
      aria-busy={busy}
      {...devLabel("DayTimeline")}
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">
          Day {dayIndex + 1} preview
        </h4>
        <span className="text-xs text-muted">
          {day.stops.length} {day.stops.length === 1 ? "stop" : "stops"}
        </span>
      </div>

      {day.stops.length === 0 ? (
        <p className="text-sm text-muted">No stops on this day yet.</p>
      ) : (
        <ol>
          {day.stops.map((stop, i) => (
            <TimelineRow
              key={`${stop.name}-${i}`}
              stop={stop}
              changed={changed.has(stop.name)}
              isLast={i === day.stops.length - 1}
            />
          ))}
        </ol>
      )}

      {day.lodging && (
        <div className="mt-3 border-t border-card-border pt-3">
          <div className="text-xs font-semibold tracking-wide text-muted uppercase">Staying</div>
          <div className="mt-1 text-sm text-foreground">{day.lodging.name}</div>
        </div>
      )}
    </div>
  );
}
