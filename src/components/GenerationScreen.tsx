"use client";

import { useEffect, useRef, useState } from "react";

import Image, { getImageProps } from "next/image";

import { devLabel } from "@/lib/devInspector";
import SectionOpener from "./blue-hour/SectionOpener";
import { formatMoney } from "@/lib/format";
import {
  STAGE_SECONDS,
  STEP_GROUPS,
  type StageProgress,
  generationProgress,
  isStepTerminal,
  stepGroupState,
} from "@/lib/generationStages";
import type { RawFetch } from "@/lib/types";
import { usePlacePhoto } from "@/lib/usePlacePhoto";

/**
 * What a traveller looks at for the ~five minutes a plan takes to write.
 *
 * This replaced a spinning "Generating" orb and a fanned stack of trivia cards floating over the
 * live Cesium globe. Three things were wrong with that. The globe is the busiest possible ground
 * for small text — every element needed its own 56px-blurred glass panel just to stay legible, and
 * the strip's own comment recorded measuring 1.02:1 against sampled globe pixels without one. The
 * orb said nothing except "working". And the screen showed almost none of what the app had already
 * fetched: by the time Generate is reachable, the real forecast for each of the traveller's dates,
 * the public holidays, and up to twelve candidate places are all sitting in memory.
 *
 * So the wait states what is known rather than asking for patience: the destination photographed
 * full-bleed, its name set large, and — the screen's real content — a rotating feed of facts about
 * the place, at display size. The machinery (four steps, one forecast line, the cancel) is demoted
 * into a darkened band at the foot.
 *
 * The ordering is deliberate and was corrected once. The first version put the forecast across
 * seven columns in the best space on the screen and the facts in small prose at the very bottom.
 * Both were backwards: `DayHeader` already prints each day's temperature, rain chance and
 * typical-weather flag beside every day of the finished plan, so the week was a preview of
 * something arriving thirty seconds later, while the facts were the one thing the traveller could
 * not get anywhere else.
 *
 * **The globe is covered, not switched off.** `useGlobeOnScreen(generating || …)` in HomeView still
 * boots Cesium at generation start, deliberately: the 2.3MB import and first tiles are free inside
 * a wait this long, and the queued destination flight replays on `setViewer` so the result view
 * opens already framed. This screen is opaque and sits on top. Un-booting it would move that cost
 * to the moment the plan arrives, which is the one moment it would be felt.
 */

/** The ground when the destination has no photograph. A real place beats a generic one every time,
 *  so this appears only where `usePlacePhoto` came back empty — which was previously flat
 *  `--canvas`, i.e. nothing at all. Dawn mist over hills is the one generic image this screen can
 *  honestly wear: it says "somewhere, early" without claiming to be the traveller's somewhere.
 *
 *  A pair, art-directed on the same 3/5 aspect ratio the hero switches on, because this is a
 *  full-bleed backdrop and the landscape crop centre-cuts badly on a phone. One threshold in the
 *  codebase rather than two. */
const FALLBACK = {
  landscape: { src: "/scenes/scenic-cloudy-background.webp", width: 2880, height: 1726 },
  portrait: { src: "/scenes/mobile-scenic-cloudy-background.webp", width: 750, height: 1714 },
};

/** Longest week the strip will lay out before collapsing the rest into a count. Trips run to 30
 *  days and thirty columns is not a strip, it is a spreadsheet. */
const MAX_WEEK_COLUMNS = 7;

/** ~150s of waiting at this interval is ~21 facts. `destinationFacts` is capped above that so the
 *  feed does not loop back to the first while the traveller is still reading. */
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
  // Already resolved and cached by the plan step, which asks the same hook for the Wikipedia
  // extract — all three variants share one request per name, so the photo costs no extra fetch.
  const photo = usePlacePhoto(destination, "full");
  // `getImageProps` only computes URLs — it renders nothing — so building these unconditionally
  // costs no request unless the `<picture>` below actually mounts.
  const fallbackCommon = { alt: "", sizes: "100vw", priority: true } as const;
  const {
    props: { srcSet: fallbackLandscape },
  } = getImageProps({ ...fallbackCommon, ...FALLBACK.landscape });
  const {
    props: { srcSet: fallbackPortrait, ...fallbackRest },
  } = getImageProps({ ...fallbackCommon, ...FALLBACK.portrait });
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

  return (
    <section
      // Opaque and full-bleed: this is what covers the globe. `z-30` sits under AppShell's
      // `z-20` navbar only because the navbar lives outside the content overlay's stacking
      // context — the bar stays visible, which is intended.
      className="pointer-events-auto fixed inset-0 z-30 flex flex-col overflow-y-auto bg-canvas"
      {...devLabel("GenerationScreen")}
    >
      {/* The destination itself, behind everything.
          Measured across eight cities before committing to this: every one resolved to a real
          landscape cityscape (aspect 1.50–1.83), but mean luminance ranged 0.040 to 0.348 and
          Kyoto peaked at 0.947 — near-white sky. White body text over that peak is 2.41:1 under a
          60% scrim and 3.56:1 under 75%, so a flat scrim cannot make small text safe anywhere.
          Hence the gradient: heavy at the top where the type sits (5.5:1 against the worst peak),
          lighter through the middle so the photograph is actually visible, and heavy again under
          the band. It is the same split the reference's own Combine section uses — large type on
          the photo, dense type in a darkened band.
          With no destination photograph this falls back to `FALLBACK` rather than to flat canvas,
          which is what the screen showed before. The scrim is shared: it was measured against
          destination photography peaking near white, and the fallback is darker than any of those,
          so it inherits a gradient with margin to spare instead of needing one of its own. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {photo ? (
          <Image src={photo} alt="" fill priority sizes="100vw" className="object-cover" />
        ) : (
          <picture>
            <source media="(min-aspect-ratio: 3/5)" srcSet={fallbackLandscape} sizes="100vw" />
            <source srcSet={fallbackPortrait} sizes="100vw" />
            <img {...fallbackRest} alt="" className="absolute inset-0 h-full w-full object-cover" />
          </picture>
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgb(var(--surface-deep-rgb) / 0.94) 0%, rgb(var(--surface-deep-rgb) / 0.9) 34%, rgb(var(--surface-deep-rgb) / 0.55) 60%, rgb(var(--surface-deep-rgb) / 0.7) 86%, rgb(var(--surface-deep-rgb) / 0.88) 100%)",
          }}
        />
      </div>

      {/* The only thing announced. The rotating fact and the week are deliberately outside it: a
          live region that re-reads on every stage change is worse than silence. */}
      <p role="status" aria-live="polite" className="sr-only">
        {complete
          ? "Your itinerary is ready."
          : `${mode === "refine" ? "Reworking" : "Building"} your ${city} itinerary — ${activeStep?.label ?? "starting"}.`}
      </p>

      {/* `my-auto`, not `justify-center` on the parent: a flex container that overflows clips its
          start, so on a phone the heading disappeared behind the fixed navbar and could not be
          scrolled back to. This centres when the content fits and tops-out when it doesn't. */}
      <div className="mx-auto my-auto w-full max-w-[100rem] px-5 py-[calc(var(--nav-h)+2rem)] sm:px-6">
        <SectionOpener label={mode === "refine" ? "Reworking" : "Planning"} align="start">
          <h1 className="font-scene-hero text-[clamp(2.5rem,9vw,8rem)] leading-[0.9] text-foreground">
            {city}.
          </h1>
          {summary && <p className="mt-4 text-sm tabular-nums text-muted">{summary}</p>}
        </SectionOpener>

        {/* The fact is the screen's second voice, not its footnote.
            It sat at the bottom in small prose, below a seven-column weather grid, where a waiting
            traveller had no reason to look. Set at display scale it earns the attention — and the
            size is also what makes it safe over photography, since large text needs 3:1 where body
            text needs 4.5:1.
            `key` on the index restarts the entrance, so a change reads as a new line arriving
            rather than as text mutating in place. */}
        <p
          key={factIndex}
          className="mt-16 max-w-4xl text-[clamp(1.375rem,3.2vw,2.5rem)] leading-[1.25] tracking-[-0.045em] text-foreground motion-safe:[animation:value-in_520ms_cubic-bezier(0.16,1,0.3,1)_backwards] lg:ml-[calc(11rem+2.5rem)]"
        >
          {facts[factIndex] ?? `Reading everything we can find about ${city}.`}
        </p>
      </div>

      {/* The working band. Everything small and dense lives here rather than on the photograph —
          at 92% the worst measured peak composites to 7.1:1 against white, which clears body text
          with room, where the same text on the open photo would not. */}
      <div
        className="mt-auto w-full border-t border-white/10"
        style={{ background: "rgb(var(--surface-deep-rgb) / 0.92)" }}
      >
        <div className="mx-auto w-full max-w-[100rem] px-5 py-6 sm:px-6">
          <div ref={stripRef} className="[--gen-progress:0]">
            <div className="relative h-px w-full bg-white/10">
              {/* Not `motion-safe:` — the transition is what makes this smooth, and removing it
                  leaves the bar jerking through ten JS writes a second. See the reduced-motion
                  exemption in globals.css. */}
              <div className="gen-fill absolute inset-y-0 left-0 w-full origin-left bg-accent [transform:scaleX(var(--gen-progress))] [transition:transform_200ms_linear]" />
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-4 lg:grid-cols-4">
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

          {/* `lg:pr-14` reserves the bottom-right corner for `LlmTraceFab`, which is a `z-50` fixed
              48px button at a 20px inset and is *not* dev-gated — it renders in production on every
              route, above this screen's `z-30`. Without the reservation the Cancel button lands
              underneath it and a hit-test at Cancel's centre returns the FAB: the control looks
              normal and is completely dead. Only at `lg`, because that is where this row goes
              horizontal and puts Cancel in the corner; stacked below that it sits at the left.
              Verified with `elementFromPoint`, not `.click()` — see The Top-Layer-Still-Inherits
              Rule for why a scripted click would have passed. */}
          <div className="mt-6 flex flex-col gap-4 border-t border-white/10 pt-4 lg:flex-row lg:items-center lg:justify-between lg:gap-10 lg:pr-14">
            {/* The forecast, demoted from a seven-column grid to one line. It is the same
                tempMin–tempMax the result view prints under every day heading (DayHeader.tsx), so
                laying it out large here spent the screen's best space on a preview of something
                the traveller sees thirty seconds later. Kept, because it is still the one concrete
                thing known about the trip before the plan exists — just no longer the headline. */}
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
                {complete ? "Opening your plan…" : `Usually about ${spellMinutes(TYPICAL_MINUTES)}.`}
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
      </div>
    </section>
  );
}
