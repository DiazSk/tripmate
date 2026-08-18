export type StageId = "geocode" | "context" | "generate" | "critique" | "placing";
export type StageStatus = "start" | "done" | "skipped";

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
 * Nominal duration per stage, and the reason the progress bar is weighted rather than five
 * equal segments. These are measured, not guessed: `generate` is ~85-105s (see the timeout
 * note in claude.ts) while geocode and placing are network round trips. Split evenly, the bar
 * would jump to 40% and then sit motionless for a minute and a half — worse than no bar,
 * because "not moving" is exactly the signal a waiting traveler reads as "stuck".
 *
 * Kept adjacent to STAGE_ORDER on purpose, with a test asserting the two carry the same keys:
 * a stage added to one and not the other is a silently wrong bar, not a crash.
 *
 * Raw seconds rather than pre-normalized fractions, because the denominator has to be
 * recomputed per call anyway — refine reports `geocode` and `placing` as `skipped`, and their
 * weight has to leave the total so the remaining three still reach exactly 100%.
 *
 * `context` is 1 and not 0 even though it is nearly always a warm cache hit: a zero-weight
 * stage is a zero-width segment, and on the runs where the cache misses and it becomes a real
 * model call, a zero-width segment is a bar that sits dead with no explanation.
 */
export const STAGE_SECONDS: Record<StageId, number> = {
  geocode: 2,
  context: 1,
  generate: 95,
  critique: 50,
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
 * The sub-stage term is what keeps the strip alive through the 95-second `generate` stage:
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
  if (!stages.some((s) => s.status === "done" || s.status === "start")) return 0;

  let total = 0;
  let acc = 0;
  for (const s of stages) {
    if (s.status === "skipped") continue;
    total += STAGE_SECONDS[s.stage];
    if (s.status === "done") acc += STAGE_SECONDS[s.stage];
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
