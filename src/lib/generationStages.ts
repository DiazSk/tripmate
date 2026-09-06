export type StageId = "geocode" | "context" | "generate" | "critique" | "placing";

/**
 * `skipped` and `failed` are deliberately distinct, and the distinction is load-bearing.
 *
 * `skipped` means "this stage was never needed" — refine reuses the previous itinerary's
 * coordinates, so it never geocodes or places. `failed` means "this stage was attempted, consumed
 * its time, and did not produce a result."
 *
 * They were one value until a real defect proved they cannot be. The runner reported a timed-out
 * critique as `skipped`; `stepGroupState` collapses a group whose every stage was skipped to
 * `done`; and the "Checking it over" group contains critique and nothing else. So a review that
 * never ran rendered to the traveller as "Checking it over — done". A comment in generationRunner
 * argued a fourth status would touch the shared vocabulary "for no visible difference" — true of
 * geocode, whose group has a live sibling to report real state, and false of any stage that is
 * alone in its group.
 */
export type StageStatus = "start" | "done" | "skipped" | "failed";

export interface StageEvent {
  stage: StageId;
  status: StageStatus;
}

/** The five stages a generate/refine call reports, in the order they occur. Stage ids
 *  deliberately match the node ids in `FLOWS` for `kind: "generate"` in pipelineFlows.ts, so
 *  the developer-facing pipeline diagram and this traveler-facing loader name the same
 *  steps — but the text below is written for someone waiting on a holiday, not a developer
 *  reading a trace, so it is not shared with FLOWS' own descriptions. */
export const STAGE_ORDER: readonly StageId[] = ["geocode", "context", "generate", "critique", "placing"];

/** What the loader tracks per stage: the SSE status, plus `pending` for "not reported yet". */
export interface StageProgress {
  stage: StageId;
  status: "pending" | StageStatus;
}

/**
 * Nominal duration per stage. Feeds both the progress bar's segment weights and the single
 * "usually about N minutes" the loader states, so it has to be a real central estimate, not a
 * hopeful one.
 *
 * Weighted rather than five equal segments because split evenly the bar would jump to 40% and
 * then sit motionless for over two minutes — worse than no bar, since "not moving" is exactly
 * the signal a waiting traveler reads as "stuck".
 *
 * Kept adjacent to STAGE_ORDER on purpose, with a test asserting the two carry the same keys:
 * a stage added to one and not the other is a silently wrong bar, not a crash.
 *
 * Raw seconds rather than pre-normalized fractions, because the denominator has to be
 * recomputed per call anyway — refine reports `geocode` and `placing` as `skipped`, and their
 * weight has to leave the total so the remaining three still reach exactly 100%.
 *
 * **Re-derived 2026-08-21 from `llm_traces`; the previous values understated the wait by ~2x**
 * (they summed to 151s and told travelers "about two and a half minutes" for a ~5 minute wait).
 * Medians over ALL rows of each type, censored rows included:
 *
 *     context   n=15   p50  24s   (0 censored)
 *     generate  n=32   p50 145s   (2 censored)
 *     critique  n=18   p50 146s   (6 censored)
 *
 * Two caveats that make these floors rather than point estimates, both worth respecting before
 * anyone "corrects" them downward:
 *
 * 1. **A timed-out row records the cap, not the duration the call needed.** Killed calls are
 *    censored observations, so any quantile computed over them is biased low, and one computed
 *    over `status='ok'` rows alone cannot exceed the cap at all. Critique's 6-of-18 censoring
 *    means its true p50 is above 146s. This exact mistake has rotted the timeout constants in
 *    claude.ts three times; do not repeat it here.
 * 2. `CRITIQUE_TIMEOUT_MS` and the generate budget were both raised to 300s on the same day
 *    these were measured, which widens what is observable. Re-derive once post-change runs
 *    accumulate.
 *
 * `context` is 11 rather than its measured 24s because a `context` trace only exists when the
 * cache MISSES — `destination_context` is a real table with a freshness window, so a hit makes
 * no model call and writes no row. Miss rate is therefore unmeasurable directly, but
 * approximable: 15 context traces against 32 generations is ~47%, and 0.47 x 24s ~= 11s. That is
 * the right number for the stated total; a miss still gets its full segment from the sub-stage
 * fill below. It stays well above 0 for the reason it always did — a zero-weight stage is a
 * zero-width segment, and on a miss that is a bar sitting dead with no explanation.
 */
export const STAGE_SECONDS: Record<StageId, number> = {
  geocode: 2,
  context: 11,
  generate: 145,
  critique: 150,
  placing: 3,
};

/**
 * How much of a stage's own expected duration the sub-stage fill treats as its time
 * constant. Lower means the fill front-loads harder and flattens sooner.
 *
 * 0.6 rather than 1.0 because at 1.0 a run of exactly the expected duration sits at 63% of
 * its segment when `done` lands — a 37% jump on a *typical* run. At 0.6 the same run is at
 * ~81%, so the jump is ~19%. It is a calibration knob, not a constant of nature: retune it
 * against real p50s from the llm_runs table if generation gets meaningfully faster.
 */
const FILL_RATIO = 0.6;

/**
 * Fraction of the whole run that is complete, 0..1, for the flight-path progress strip.
 *
 * `stageElapsedMs` is time since the *currently running stage* started, not since the run
 * started. `previous` is the last value this returned; the result never goes below it.
 *
 * The sub-stage term is what keeps the strip alive through the ~145-second `generate` stage:
 * `1 - exp(-t/tau)` approaches its segment's end without ever arriving, so the segment
 * cannot complete until the real `done` event lands. That is a structural guarantee rather
 * than a "stop at 95%" clamp — there is no value of `t` that finishes the segment early.
 *
 * Sums the `done` weights rather than walking until the first `pending`, because the runner
 * genuinely overlaps stages: it emits `context: start` *before* `geocode: start` so the
 * context model call can run concurrently, which means two stages report `start` at once and
 * a walk-until-pending would return 0 for the whole time context is running.
 */
export function generationProgress(
  stages: readonly StageProgress[],
  stageElapsedMs: number,
  previous: number
): number {
  // A run that has not reported anything yet resets the bar to empty, ignoring `previous`.
  // This is what lets a second generation start from zero without the component holding an
  // "is this a new run" flag: page.tsx already resets `stages` to all-pending before each
  // call, so the data says it.
  if (!stages.some((s) => s.status === "done" || s.status === "start" || s.status === "failed"))
    return 0;

  let total = 0;
  let acc = 0;
  for (const s of stages) {
    // `skipped` leaves the denominator entirely — that stage was never needed, so its weight
    // would otherwise cap the bar below 100%. `failed` does NOT: the stage was attempted and
    // really did consume its time (a killed critique burns its whole 300s budget), so counting
    // it as spent is what keeps the bar honest instead of stalling on weight nothing will ever
    // fill.
    if (s.status === "skipped") continue;
    total += STAGE_SECONDS[s.stage];
    if (s.status === "done" || s.status === "failed") acc += STAGE_SECONDS[s.stage];
  }
  if (total <= 0) return Math.min(1, Math.max(previous, 0));

  let fraction = acc / total;

  // First stage reporting `start`, matching how the loader picks the stage it captions, so
  // the strip's filling segment and the caption below it always name the same stage.
  const running = stages.find((s) => s.status === "start");
  if (running) {
    const tau = STAGE_SECONDS[running.stage] * 1000 * FILL_RATIO;
    const within = 1 - Math.exp(-Math.max(0, stageElapsedMs) / tau);
    fraction += (STAGE_SECONDS[running.stage] / total) * within;
  }

  // Never regress. This earns its keep on a real case rather than a hypothetical: during the
  // context/geocode overlap above, `find(start)` returns context first and then geocode once
  // geocode starts, which would otherwise drop the sub-stage term back toward zero.
  return Math.min(1, Math.max(previous, fraction));
}

export interface StageMeta {
  /** Short label for the stage's row in the loader — not the rotating caption. */
  label: string;
  /** Rotates every 2.5s while this stage is the active one. Never empty. */
  captions: string[];
}

const GENERATE_META: Record<StageId, StageMeta> = {
  geocode: {
    label: "Locating",
    captions: ["Finding your destination…", "Pulling the real forecast…"],
  },
  context: {
    label: "Context",
    captions: ["Checking festivals and events…", "Reading local safety notes…"],
  },
  generate: {
    label: "Planning",
    captions: [
      "Charting the route…",
      "Scouting places to stay…",
      "Plotting the best stops…",
      "Balancing the budget…",
      "Writing the day-by-day plan…",
    ],
  },
  critique: {
    label: "Reviewing",
    captions: ["Double-checking the budget…", "Reviewing stop timing…"],
  },
  placing: {
    label: "Placing",
    captions: ["Correcting map coordinates…"],
  },
};

/** Refine reuses most of the same stage set — geocode and placing are always skipped (the
 *  previous itinerary's coordinates are reused, not refetched), and generate/context/critique
 *  get refine-flavored captions to match the "Rethinking" word GenerationLoader already shows
 *  for this mode. */
const REFINE_META: Record<StageId, StageMeta> = {
  ...GENERATE_META,
  context: {
    label: "Context",
    captions: ["Re-checking festivals and events…"],
  },
  generate: {
    label: "Reworking",
    captions: [
      "Reading your notes…",
      "Reworking the days…",
      "Rebalancing the budget…",
      "Finalizing the changes…",
    ],
  },
  critique: {
    label: "Reviewing",
    captions: ["Re-checking the budget…", "Re-checking stop timing…"],
  },
};

export function stageMeta(mode: "generate" | "refine", stage: StageId): StageMeta {
  return (mode === "refine" ? REFINE_META : GENERATE_META)[stage];
}

/**
 * The five reported stages, grouped into the four a traveller can act on.
 *
 * `geocode` and `context` total a few seconds of the ~310 and mean nothing to anyone waiting, so
 * they share a column. The four that remain are the same four the landing's "How it actually
 * works" promises — the page says what will happen, and this shows it happening. Progress itself
 * is still computed from all five by `generationProgress`; only the display groups.
 *
 * Lives here rather than in GenerationScreen so `stepGroupState` below is reachable from a test:
 * a `.test.mjs` can import a `.ts` module (Node strips the types) but not a `.tsx` one, because
 * nothing in the test runner transforms JSX. The rule this encodes had already shipped a
 * user-visible lie once while sitting untested inside the component.
 */
export const STEP_GROUPS: readonly { id: string; label: string; stages: readonly StageId[] }[] = [
  { id: "read", label: "Reading the place", stages: ["geocode", "context"] },
  { id: "write", label: "Writing the plan", stages: ["generate"] },
  { id: "check", label: "Checking it over", stages: ["critique"] },
  { id: "place", label: "Placing every stop", stages: ["placing"] },
];

export type StepState = "done" | "active" | "waiting" | "failed";

/**
 * What one display group shows, given the stage statuses underneath it.
 *
 * The `failed` branch is the whole reason this is a named, tested function. Its absence produced
 * a real user-visible lie: a timed-out critique reported `skipped`, every stage in the "check"
 * group was then skipped, the empty-group rule collapsed that to `done`, and the loader told the
 * traveller "Checking it over — done" about a review that never ran. `skipped` and `failed` being
 * one value was the root cause; the empty-group rule was correct all along and is kept.
 *
 * A group with a failed stage reports `failed` even if its siblings succeeded — a partial result
 * is the thing worth surfacing, and silently rounding it up to `done` is what went wrong before.
 */
export function stepGroupState(
  group: { stages: readonly StageId[] },
  stages: readonly StageProgress[]
): StepState {
  const mine = stages.filter((s) => group.stages.includes(s.stage));
  // Every stage here was skipped, so this group had nothing to do. Legitimate: refine reuses the
  // previous itinerary's coordinates and so never geocodes or places.
  const live = mine.filter((s) => s.status !== "skipped");
  if (live.length === 0) return "done";

  if (live.some((s) => s.status === "start")) return "active";
  if (live.some((s) => s.status === "failed")) return "failed";
  return live.every((s) => s.status === "done") ? "done" : "waiting";
}

/** `failed` is terminal, not pending. Without this a timed-out critique would leave the loader
 *  showing "usually about five minutes" and a cancel button forever, while the finished plan sat
 *  waiting to open. */
export function isStepTerminal(state: StepState): boolean {
  return state === "done" || state === "failed";
}

/**
 * How long a generation takes, in words, derived from `STAGE_SECONDS` above.
 *
 * **This is the only place the app is allowed to say how long the wait is.** It lived in
 * `GenerationScreen` and three surfaces disagreed with each other and with the data: the loader
 * said "about five minutes" (derived, correct), the review step said "about two minutes", and the
 * landing page's How-it-works said "about two and a half minutes". A traveler could read all
 * three inside one flow, and the two written ones were the stale pre-2026-08-21 estimate that
 * `STAGE_SECONDS`' own comment records as understating the wait by ~2x.
 *
 * Derived rather than written, so re-deriving `STAGE_SECONDS` from `llm_traces` moves every
 * surface at once and none of them can rot separately. Read the caveats on `STAGE_SECONDS`
 * before adjusting it downward — timed-out rows are censored observations and bias any quantile
 * over them low, so those numbers are floors.
 */
export const TYPICAL_WAIT_MINUTES =
  Math.round((Object.values(STAGE_SECONDS).reduce((a, b) => a + b, 0) / 60) * 2) / 2;

/** "2.5" reads as an instrument reading; a wait is spoken, not measured. */
export function spellMinutes(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  const words = ["zero", "one", "two", "three", "four", "five"];
  const w = words[whole] ?? String(whole);
  if (!half) return `${w} minute${whole === 1 ? "" : "s"}`;
  return whole === 0 ? "half a minute" : `${w} and a half minutes`;
}

/** The spoken wait, e.g. "five minutes". Every surface that quotes a duration uses this. */
export const TYPICAL_WAIT_PHRASE = spellMinutes(TYPICAL_WAIT_MINUTES);
