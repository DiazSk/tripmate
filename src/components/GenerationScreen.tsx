"use client";

import { useEffect, useRef, useState } from "react";

import { devLabel } from "@/lib/devInspector";
import SectionOpener from "./blue-hour/SectionOpener";
import { formatMoney } from "@/lib/format";
import {
  STAGE_SECONDS,
  type StageId,
  type StageProgress,
  generationProgress,
} from "@/lib/generationStages";
import type { RawFetch } from "@/lib/types";

/**
 * What a traveller looks at for the two and a half minutes a plan takes to write.
 *
 * This replaced a spinning "Generating" orb and a fanned stack of trivia cards floating over the
 * live Cesium globe. Three things were wrong with that. The globe is the busiest possible ground
 * for small text — every element needed its own 56px-blurred glass panel just to stay legible, and
 * the strip's own comment recorded measuring 1.02:1 against sampled globe pixels without one. The
 * orb said nothing except "working". And the screen showed almost none of what the app had already
 * fetched: by the time Generate is reachable, the real forecast for each of the traveller's dates,
 * the public holidays, and up to twelve candidate places are all sitting in memory.
 *
 * So the wait states what is known rather than asking for patience. Flat ground, the destination
 * set large, the four steps as a ruled strip, and the actual week laid out underneath.
 *
 * **The globe is covered, not switched off.** `useGlobeOnScreen(generating || …)` in HomeView still
 * boots Cesium at generation start, deliberately: the 2.3MB import and first tiles are free inside
 * a wait this long, and the queued destination flight replays on `setViewer` so the result view
 * opens already framed. This screen is opaque and sits on top. Un-booting it would move that cost
 * to the moment the plan arrives, which is the one moment it would be felt.
 */

/** The five reported stages, grouped into the four a traveller can act on.
 *
 *  `geocode` and `context` total three seconds of the ~150 and mean nothing to anyone waiting, so
 *  they share a column. The four that remain are the same four the landing's "How it actually
 *  works" promises — the page says what will happen, and this shows it happening. Progress itself
 *  is still computed from all five by `generationProgress`; only the display groups. */
const STEPS: { id: string; label: string; stages: StageId[] }[] = [
  { id: "read", label: "Reading the place", stages: ["geocode", "context"] },
  { id: "write", label: "Writing the plan", stages: ["generate"] },
  { id: "check", label: "Checking it over", stages: ["critique"] },
  { id: "place", label: "Placing every stop", stages: ["placing"] },
];

/** Longest week the strip will lay out before collapsing the rest into a count. Trips run to 30
 *  days and thirty columns is not a strip, it is a spreadsheet. */
const MAX_WEEK_COLUMNS = 7;

const FACT_INTERVAL_MS = 7000;

/** Measured, not guessed: `STAGE_SECONDS` sums to ~151s. Stated once as a range rather than
 *  counted down — a ticking estimate that stalls at "10 seconds" is worse than no estimate. */
const TYPICAL_MINUTES = Math.round((Object.values(STAGE_SECONDS).reduce((a, b) => a + b, 0) / 60) * 2) / 2;

/** "2.5" reads as an instrument reading; a wait is spoken, not measured. */
function spellMinutes(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  const words = ["zero", "one", "two", "three", "four", "five"];
  const w = words[whole] ?? String(whole);
  if (!half) return `${w} minute${whole === 1 ? "" : "s"}`;
  return whole === 0 ? "half a minute" : `${w} and a half minutes`;
}

type StepState = "done" | "active" | "waiting";

function stepState(step: (typeof STEPS)[number], stages: StageProgress[]): StepState {
  const mine = stages.filter((s) => step.stages.includes(s.stage) && s.status !== "skipped");
  if (mine.length === 0) return "done"; // every stage in this group was skipped (refine)
  if (mine.some((s) => s.status === "start")) return "active";
  return mine.every((s) => s.status === "done") ? "done" : "waiting";
}

/** "2026-08-20" → "Thu 20", using UTC accessors. A date-only string parses as UTC midnight, so
 *  local accessors roll it back a day anywhere west of Greenwich — this app has shipped that bug
 *  before and DESIGN.md records it. */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  // Composed rather than one `toLocaleDateString` call: asking en-US for weekday + day with no
  // month in the pattern returns "19 Sat", which reads as a date typo.
  const weekday = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${weekday} ${d.getUTCDate()}`;
}

function skyLabel(precip: number | null): string | null {
  if (precip === null) return null;
  return precip >= 40 ? `${precip}% rain` : precip >= 15 ? `${precip}% cloud` : "clear";
}

export default function GenerationScreen({
  mode = "generate",
  stages,
  facts,
  destination,
  dateRange,
  tripDays,
  tierName,
  budget,
  rawFetch,
  onCancel,
}: {
  mode?: "generate" | "refine";
  stages: StageProgress[];
  facts: string[];
  destination: string;
  dateRange: string | null;
  tripDays: number | null;
  tierName: string | null;
  budget: number;
  rawFetch: RawFetch | null;
  onCancel?: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [factIndex, setFactIndex] = useState(0);
  const [cancelReady, setCancelReady] = useState(false);

  const city = destination.split(",")[0]?.trim() || destination.trim() || "your trip";
  const activeStep = STEPS.find((s) => stepState(s, stages) === "active") ?? null;
  const complete = STEPS.every((s) => stepState(s, stages) === "done");

  // Progress is written straight to a CSS custom property, never to React state. It ticks ten
  // times a second, and re-rendering this tree at that rate would reconcile the week strip and the
  // fact line for a value only one bar reads.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const stageStart = Date.now();
    let previous = 0;
    const tick = () => {
      previous = generationProgress(stages, Date.now() - stageStart, previous);
      el.style.setProperty("--gen-progress", String(previous));
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [stages]);

  // Cancel appears late on purpose: offered immediately it reads as an expectation that this will
  // go wrong, and it flashes past on a fast run.
  useEffect(() => {
    const id = setTimeout(() => setCancelReady(true), 10000);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (facts.length < 2) return;
    const id = setInterval(() => setFactIndex((i) => (i + 1) % facts.length), FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [facts.length]);

  const weatherDays = rawFetch?.weather.available ? rawFetch.weather.days : [];
  const calendarDays = rawFetch?.dateContext.days ?? [];
  const week = weatherDays.slice(0, MAX_WEEK_COLUMNS).map((d, i) => ({
    // The historical fallback reports last year's calendar dates, so the label comes from the trip
    // day at the same position rather than from the weather row's own date.
    label: dayLabel(calendarDays[i]?.date ?? d.date),
    temp: `${Math.round(d.tempMinC)}–${Math.round(d.tempMaxC)}°`,
    sky: skyLabel(d.precipitationProbability),
  }));
  const hiddenDays = Math.max(0, weatherDays.length - week.length);
  // Beyond the 16-day horizon Open-Meteo falls back to the same dates last year, which carries
  // temperatures but no precipitation probability. A column of em dashes states nothing; one note
  // under the strip states the actual situation.
  const hasSky = week.some((d) => d.sky !== null);
  const historical = rawFetch?.weather.historical === true;

  const summary = [dateRange, tripDays ? `${tripDays} days` : null, tierName, budget > 0 ? formatMoney(budget) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      // Opaque and full-bleed: this is what covers the globe. `z-30` sits under AppShell's
      // `z-20` navbar only because the navbar lives outside the content overlay's stacking
      // context — the bar stays visible, which is intended.
      className="pointer-events-auto fixed inset-0 z-30 flex flex-col overflow-y-auto bg-canvas px-5 py-[calc(var(--nav-h)+2rem)] sm:px-6"
      {...devLabel("GenerationScreen")}
    >
      {/* The only thing announced. The week strip and the rotating fact are deliberately outside
          it: a live region that re-reads a seven-column table every time a stage advances is worse
          than silence. */}
      <p role="status" aria-live="polite" className="sr-only">
        {complete
          ? "Your itinerary is ready."
          : `${mode === "refine" ? "Reworking" : "Building"} your ${city} itinerary — ${activeStep?.label ?? "starting"}.`}
      </p>

      {/* `my-auto`, not `justify-center` on the parent: a flex container that overflows clips its
          start, so on a phone the heading disappeared behind the fixed navbar and could not be
          scrolled back to. This centres when the content fits and tops-out when it doesn't. */}
      <div className="mx-auto my-auto w-full max-w-[100rem]">
        <SectionOpener label={mode === "refine" ? "Reworking" : "Planning"} align="start">
          <h1 className="font-scene-hero text-[clamp(2.5rem,9vw,8rem)] leading-[0.9] text-foreground">
            {city}.
          </h1>
          {summary && <p className="mt-4 text-sm tabular-nums text-muted">{summary}</p>}
        </SectionOpener>

        {/* The four steps, as a ruled strip. One shared rail carries the fill, so the columns read
            as one process rather than four independent meters. */}
        <div ref={stripRef} className="mt-12 [--gen-progress:0]">
          <div className="relative h-px w-full bg-white/10">
            {/* Not `motion-safe:` — the transition is what makes this smooth, and removing it
                leaves the bar jerking through ten JS writes a second. See the reduced-motion
                exemption in globals.css. */}
            <div className="gen-fill absolute inset-y-0 left-0 w-full origin-left bg-accent [transform:scaleX(var(--gen-progress))] [transition:transform_200ms_linear]" />
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 pt-5 lg:grid-cols-4">
            {STEPS.map((step, i) => {
              const state = stepState(step, stages);
              return (
                <div key={step.id} className="flex items-start gap-2">
                  <span
                    className={`text-[0.62rem] font-semibold leading-none ${
                      state === "waiting" ? "text-white/40" : "text-accent"
                    }`}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <p
                      className={`text-sm font-medium ${
                        state === "waiting" ? "text-white/55" : "text-foreground"
                      }`}
                    >
                      {step.label}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {state === "done" ? "done" : state === "active" ? "now" : "—"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* The week. Real forecast for the traveller's real dates, fetched three screens before
            Generate was reachable — the single most useful thing that can be on this screen, and
            it was previously not on it at all. */}
        {week.length > 0 && (
          <div className="mt-14">
            <p className="text-sm font-semibold tracking-[-0.045em] text-white/55">Your week</p>
            {/* Rules only at `lg`, where all seven days sit on one row and a divider means
                "next day". Below that the grid wraps, and `:not(:first-child)` put a left border
                on the first cell of every wrapped row — a vertical rule floating in open space. */}
            <div className="mt-4 grid grid-cols-2 gap-y-6 border-t border-white/10 pt-4 sm:grid-cols-4 lg:grid-cols-7 lg:gap-y-0 lg:pt-0">
              {week.map((d) => (
                <div
                  key={d.label}
                  className="border-white/10 pr-4 lg:py-4 lg:[&:not(:nth-child(7n+1))]:border-l lg:[&:not(:nth-child(7n+1))]:pl-4"
                >
                  <p className="text-sm font-medium text-foreground">{d.label}</p>
                  <p className="mt-2 text-base tabular-nums text-foreground">{d.temp}</p>
                  {d.sky && <p className="mt-1 text-xs text-muted">{d.sky}</p>}
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1 text-xs text-muted">
              {hiddenDays > 0 && (
                <p>
                  +{hiddenDays} more {hiddenDays === 1 ? "day" : "days"} in the plan
                </p>
              )}
              {historical && (
                <p>
                  These dates are past the forecast horizon
                  {hasSky ? "" : ", so there is no rain probability yet"} — the figures are the
                  same dates last year.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-14 flex flex-col gap-6 border-t border-white/10 pt-6 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
          {/* One fact, not a fanned stack of five. `key` on the index restarts the entrance so a
              change reads as a new line arriving rather than as text mutating in place. */}
          <p
            key={factIndex}
            className="scene-prose max-w-xl text-base text-foreground motion-safe:[animation:value-in_420ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
          >
            {facts[factIndex] ?? `Reading everything we can find about ${city}.`}
          </p>

          <div className="flex shrink-0 flex-col items-start gap-4 lg:items-end">
            <p className="text-xs text-muted">
              {complete ? "Opening your plan…" : `Usually about ${spellMinutes(TYPICAL_MINUTES)}.`}
            </p>
            {onCancel && cancelReady && !complete && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-full bg-surface-deep px-5 py-2.5 text-sm font-semibold tracking-[-0.045em] text-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:scale-[0.98]"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
