"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { devLabel } from "@/lib/devInspector";
import { formatMoney } from "@/lib/format";
import {
  STEP_GROUPS,
  TYPICAL_WAIT_PHRASE,
  type StageProgress,
  generationProgress,
  isStepTerminal,
  stepGroupState,
} from "@/lib/generationStages";
import type { RawFetch } from "@/lib/types";

/**
 * What a traveller looks at for the ~five minutes a plan takes to write.
 *
 * **This was a full-bleed opaque layer, and the reasoning that made it one still holds — it just
 * no longer applies.** It covered the globe because the globe is the busiest possible ground for
 * small text (every element needed its own 56px-blurred glass panel to stay legible, and the
 * previous strip's comment recorded measuring 1.02:1 against sampled globe pixels without one) and
 * because the globe had *nothing to say* underneath it: a spinning orb over scenery the traveller
 * had no reason to look at. Covering it with the destination photographed full-bleed, the city set
 * large, and a rotating feed of real facts about the place was strictly more than the map offered.
 *
 * The map has something to say now. The generation stream writes each stop as the model produces
 * it, so the route, the pins and the card behind this band build themselves over the whole wait —
 * the traveller's own plan, drawing itself on their own destination. That is worth more than a
 * photograph of the same city, so the layer collapses into the darkened foot band it already had.
 *
 * **The legibility problem is re-introduced deliberately, and answered the same way it always was.**
 * Nothing small is set on the open map. Everything dense lives in this band, at 92% over
 * `--surface-deep` — where the worst measured bright ground composites to 7.1:1 against white,
 * which clears body text with room. Only 8% of whatever is moving underneath reaches through, so a
 * light-terrain pan does not change the number. Do not thin this background to "let the map show":
 * the band's opacity is the entire reason small text is allowed on this screen at all.
 *
 * Three things came down from the layer rather than going away with it:
 *
 * - **Cancel.** A five-minute call the traveller cannot stop is a trap.
 * - **The four-group progress strip.** Still meaningful even with the plan drawing itself. It
 *   covers the ten-odd seconds before the first stop arrives, when the map has nothing on it yet,
 *   and it is the only place the stages the map cannot show — the context fetch, the critique,
 *   the coordinate pass — are named at all. Note where it stops: `showPlan` in HomeView drops
 *   `generating` the moment the plan is interactive, so this band unmounts there while the
 *   critique keeps running. Deliberately — a status band over a finished, editable plan for
 *   another two minutes is worse than none. The critique is not unreported, though: HomeView
 *   prints one muted line in the panel footer for as long as it runs (`reviewing`), and marks
 *   the days it actually changed with the same unseen-day dots the chat uses. Don't extend this
 *   band to cover that window; the whole point is that it ends.
 * - **The rotating facts.** The feed was the entire point of this screen's last rewrite — by the
 *   time Generate is reachable the app already holds the real forecast, the public holidays and up
 *   to twelve candidate places, and was showing none of it. It keeps the band's largest type and
 *   sits beside the strip. Dropping it here would have been a regression dressed as a feature.
 *
 * The forecast line stays where it was demoted to: `DayHeader` prints each day's temperature
 * beside every day of the finished plan, so it was never worth the screen's best space — but it is
 * still the one concrete thing known about the trip before the plan exists.
 *
 * **The globe is now uncovered rather than covered.** `useGlobeOnScreen(generating || …)` in
 * HomeView already booted Cesium at generation start so the result view would open already framed;
 * that cost is now spent on something visible for the whole wait instead of on a head start behind
 * an opaque sheet.
 */

/** Longest week the strip will lay out before collapsing the rest into a count. Trips run to 30
 *  days and thirty columns is not a strip, it is a spreadsheet. */
const MAX_WEEK_COLUMNS = 7;

/** ~150s of waiting at this interval is ~21 facts. `destinationFacts` is capped above that so the
 *  feed does not loop back to the first while the traveller is still reading. */
const FACT_INTERVAL_MS = 7000;

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
  const activeStep = STEP_GROUPS.find((s) => stepGroupState(s, stages) === "active") ?? null;
  // Terminal, not "done": a failed critique must still let the loader finish, or it would sit
  // on "usually about five minutes" with a cancel button while the finished plan waited.
  const complete = STEP_GROUPS.every((s) => isStepTerminal(stepGroupState(s, stages)));

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
  }));
  const hiddenDays = Math.max(0, weatherDays.length - week.length);
  // Beyond the 16-day horizon Open-Meteo falls back to the same dates last year. Worth one short
  // tail on the line: a figure presented as a forecast when it is last year's is a lie by omission,
  // however small the type.
  const historical = rawFetch?.weather.historical === true;

  const summary = [dateRange, tripDays ? `${tripDays} days` : null, tierName, budget > 0 ? formatMoney(budget) : null]
    .filter(Boolean)
    .join(" · ");

  // Portalled to `document.body`, and that is not tidiness — it is the only way this band can be
  // above the map's own chrome. HomeView renders it inside `.content-overlay`, which is `z-10`
  // and therefore a stacking context, so every z-index in here is trapped under it: `MapControls`
  // is a `z-20` *sibling* of that overlay, and its zoom pill and tilt slider drew straight
  // through an opaque band at `z-40`, the slider's thumb landing on the rotating fact's first
  // word. The full-bleed layer this replaced never showed the bug because the wizard's steps
  // carry `.map-chrome-hidden`, which took the control stack off screen for the whole wait — and
  // a generating run cannot carry that class any more, since the same rule also hides
  // `.stop-marker-layer`, i.e. the stops this band exists to uncover. Safe to read `document.body`
  // in render: HomeView imports this behind `dynamic(…, { ssr: false })`.
  return createPortal(
    <section
      // Bottom-anchored, not full-bleed: the map above it is the wait now, and this band claims
      // pointer events only over its own strip.
      // That is not the same as the map being draggable for the whole wait, and the difference is
      // worth knowing. `.content-overlay:not(:has(.docked-panel))` in globals.css hands pointer
      // events back to the full-viewport overlay, and being unlayered it beats Tailwind's
      // `pointer-events-none` utility on that element. HomeView only mounts `DockedPanel` once
      // there is a plan to put in it, so for the ~40s before the first streamed stop arrives the
      // overlay still swallows every gesture and the map cannot be dragged; the moment the card
      // mounts, the `:has()` stops matching and the map silently becomes draggable. Acceptable —
      // there is nothing on the map to go and look at until then — but it is a state change
      // nothing announces.
      // `z-40` clears `DockedPanel`'s `z-10` capsule and the marker cards at `z-5`, and stays under
      // `LlmTraceFab` at `z-50` — see the `lg:pr-14` note on the cancel row for why that matters.
      // The dark treatment is the band's original one, kept unchanged: it was designed for
      // legibility over busy ground, which is exactly the problem a live map re-introduces.
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 border-t border-white/10"
      style={{ background: "rgb(var(--surface-deep-rgb) / 0.92)" }}
      {...devLabel("GenerationScreen")}
    >
      {/* The only thing announced. The rotating fact and the week are deliberately outside it: a
          live region that re-reads on every stage change is worse than silence. */}
      <p role="status" aria-live="polite" className="sr-only">
        {complete
          ? "Your itinerary is ready."
          : `${mode === "refine" ? "Reworking" : "Building"} your ${city} itinerary — ${activeStep?.label ?? "starting"}.`}
      </p>

      <div className="mx-auto w-full max-w-[100rem] px-5 py-5 sm:px-6">
        <div ref={stripRef} className="[--gen-progress:0]">
          <div className="relative h-px w-full bg-white/10">
            {/* Not `motion-safe:` — the transition is what makes this smooth, and removing it
                leaves the bar jerking through ten JS writes a second. See the reduced-motion
                exemption in globals.css. */}
            <div className="gen-fill absolute inset-y-0 left-0 w-full origin-left bg-accent [transform:scaleX(var(--gen-progress))] [transition:transform_200ms_linear]" />
          </div>

          {/* The fact beside the strip rather than under the photograph it used to sit on. It
              keeps the largest type in the band — partly because it is still the screen's real
              content, and partly because large text needs 3:1 where body text needs 4.5:1, which
              is the margin worth having on the one element people actually read while waiting. */}
          <div className="grid gap-x-10 gap-y-5 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <div>
              <p className="text-[0.62rem] font-semibold tracking-[0.14em] text-accent uppercase">
                {mode === "refine" ? "Reworking" : "Planning"} {city}
              </p>
              {/* `key` on the index restarts the entrance, so a change reads as a new line
                  arriving rather than as text mutating in place. `min-h` because this band is
                  anchored to the bottom edge: a two-line fact replacing a one-line one would
                  otherwise shove the whole band up and down every seven seconds. */}
              <p
                key={factIndex}
                className="mt-2 min-h-[4rem] text-[clamp(1rem,1.7vw,1.375rem)] leading-[1.3] tracking-[-0.035em] text-foreground motion-safe:[animation:value-in_520ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
              >
                {facts[factIndex] ?? `Reading everything we can find about ${city}.`}
              </p>
              {summary && <p className="text-xs tabular-nums text-muted">{summary}</p>}
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4 self-start sm:grid-cols-4">
              {STEP_GROUPS.map((step, i) => {
                const state = stepGroupState(step, stages);
                return (
                  <div key={step.id} className="flex items-start gap-2">
                    <span
                      className={`text-[0.62rem] font-semibold leading-none ${
                        state === "waiting" || state === "failed" ? "text-white/40" : "text-accent"
                      }`}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <p
                        className={`text-sm font-medium ${
                          state === "waiting" || state === "failed" ? "text-white/55" : "text-foreground"
                        }`}
                      >
                        {step.label}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {state === "done"
                          ? "done"
                          : state === "active"
                            ? "now"
                            : state === "failed"
                              ? "not run"
                              : "—"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* `lg:pr-14` reserves the bottom-right corner for `LlmTraceFab`, which is a `z-50` fixed
            48px button at a 20px inset and is *not* dev-gated — it renders in production on every
            route, above this band's `z-40`. Without the reservation the Cancel button lands
            underneath it and a hit-test at Cancel's centre returns the FAB: the control looks
            normal and is completely dead. Only at `lg`, because that is where this row goes
            horizontal and puts Cancel in the corner; stacked below that it sits at the left.
            Verified with `elementFromPoint`, not `.click()` — see The Top-Layer-Still-Inherits
            Rule for why a scripted click would have passed. */}
        <div className="mt-5 flex flex-col gap-4 border-t border-white/10 pt-4 lg:flex-row lg:items-center lg:justify-between lg:gap-10 lg:pr-14">
          {/* The forecast, one line. It is the same tempMin–tempMax the result view prints under
              every day heading (DayHeader.tsx), so it was never worth more than this — but it is
              still the one concrete thing known about the trip before the plan exists. */}
          {week.length > 0 ? (
            <p className="text-xs tabular-nums text-muted">
              <span className="text-white/55">Forecast</span>{" "}
              {week.map((d) => `${d.label} ${d.temp}`).join("  ·  ")}
              {hiddenDays > 0 && `  ·  +${hiddenDays} more`}
              {historical && <span className="text-white/40"> · same dates last year</span>}
            </p>
          ) : (
            <span />
          )}

          <div className="flex shrink-0 items-center gap-4">
            <p className="text-xs text-muted">
              {complete ? "Opening your plan…" : `Usually about ${TYPICAL_WAIT_PHRASE}.`}
            </p>
            {onCancel && cancelReady && !complete && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold tracking-[-0.045em] text-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:scale-[0.98]"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </section>,
    document.body
  );
}
