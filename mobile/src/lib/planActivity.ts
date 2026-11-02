import { STEP_GROUPS, isStepTerminal, stepGroupState, type StageProgress } from '@shared/generationStages';

import { nowLine, type PlanDay } from '@/lib/writingPlan';

/**
 * The plan being written, as the Dynamic Island and the Lock Screen show it (`planLiveActivity.tsx`),
 * the canvas design "Live Activity · 2 Writing the plan".
 *
 * **Without push, and that decides the shape.** TripMate's Apple team is a free one, which iOS gives
 * no push for, so this Live Activity is updated only while the app is in front — exactly when iOS hides
 * it. What it shows once the traveller has left is therefore what was true as they left, plus what
 * the system can move on its own on a clock: the ring, the countdown, and **each step's segment
 * filling over its own scheduled slot** (`segments`), so the bar still moves through Checking and
 * Placing with the app closed. The words cannot: the title stays on the last step the app saw. Past
 * the whole run's estimate it goes stale (`planActivityStaleAt`) and says to open TripMate. The
 * plan itself is safe either way (`saveTripForRun`).
 */
export type PlanActivityPhase = 'writing' | 'ready' | 'failed';

/** Serialized to the widget, so dates travel as epoch milliseconds. */
export type PlanActivityProps = {
  /** "Planning Jaipur", "Jaipur is ready", "Not finished". */
  eyebrow: string;
  /** The step, or the outcome: "Writing the plan", "7 days, 19 stops". */
  title: string;
  /** The now-line under it: "Day 3 of 7 · Jantar Mantar". */
  sub: string;
  /** "Nov 6 – 12 · 7 days · Mid-range". */
  meta: string;
  /** The Lock Screen's line, in the display serif: a fact about the place while it is written. */
  fact: string;
  /** 0-3, the running step; the segments before it are done. */
  stepIndex: number;
  stepCount: number;
  startedAt: number;
  /** How far through the estimate the last update was, 0 to 1: the Lock Screen's ring. */
  progress: number;
  /** Each step's slot, from and to, epoch ms: the running one and every one after it fill on their own. */
  segments: { from: number; to: number }[];
  /** The end of the last slot: the countdown's zero. */
  etaAt: number;
  phase: PlanActivityPhase;
  /** A file in the widgets' shared directory (`widgetsDirectory`), or null. */
  photo: string | null;
};

/**
 * How long each step takes, in seconds: reading, writing, checking, placing. Measured on real runs
 * (2026-11-01, Seattle: sketch 16s, writing 263s, checking 175s), not the writing screen's 150s
 * hand-off, which ends before checking starts: on that estimate the island gave up mid-writing.
 */
export const STEP_SECONDS = [15, 255, 175, 5];
/** However late a step runs, its slot stays at least this far ahead while it is running. */
const ETA_FLOOR_MS = 15_000;
/** How long past the estimate the island keeps its countdown before it says to open the app. */
const STALE_AFTER_MS = 60_000;

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen'];

/** The step running, or about to: 0-3. */
export function currentStepIndex(stages: readonly StageProgress[]): number {
  const active = STEP_GROUPS.find((g) => stepGroupState(g, stages) === 'active');
  const current = active ?? STEP_GROUPS.find((g) => !isStepTerminal(stepGroupState(g, stages))) ?? STEP_GROUPS[STEP_GROUPS.length - 1];
  return STEP_GROUPS.indexOf(current);
}

export function planActivityProps(input: {
  destination: string;
  dateRange: string | null;
  tripDays: number;
  tierName: string | null;
  stages: readonly StageProgress[];
  days: PlanDay[];
  facts: readonly string[];
  startedAt: number;
  /** When the running step started, as the app saw it. */
  stepStartedAt: number;
  now: number;
  phase: PlanActivityPhase;
  photo: string | null;
}): PlanActivityProps {
  const { stages, phase, tripDays } = input;
  const city = input.destination.split(',')[0]?.trim() || input.destination.trim();
  const active = STEP_GROUPS.find((g) => stepGroupState(g, stages) === 'active') ?? null;
  // Between steps nothing is running; the step about to start is the one worth naming.
  const current = active ?? STEP_GROUPS.find((g) => !isStepTerminal(stepGroupState(g, stages))) ?? STEP_GROUPS[STEP_GROUPS.length - 1];
  const stepIndex = STEP_GROUPS.indexOf(current);
  // The running step's slot from when it started, never ending in the past; each later one after it.
  const segments: { from: number; to: number }[] = [];
  let at = input.stepStartedAt;
  STEP_SECONDS.forEach((seconds, i) => {
    if (i < stepIndex) return segments.push({ from: input.startedAt, to: input.startedAt });
    const to = i === stepIndex ? Math.max(at + seconds * 1000, input.now + ETA_FLOOR_MS) : at + seconds * 1000;
    segments.push({ from: at, to });
    at = to;
  });
  const etaAt = at;
  const stops = input.days.reduce((n, d) => n + d.stops.length, 0);
  const dayWord = `${WORDS[tripDays] ?? tripDays} ${tripDays === 1 ? 'day' : 'days'}`;
  const text =
    phase === 'ready'
      ? { eyebrow: `${city} is ready`, title: `${tripDays} ${tripDays === 1 ? 'day' : 'days'}, ${stops} ${stops === 1 ? 'stop' : 'stops'}`, sub: 'A draft until you keep it', fact: `${city}, in ${dayWord}.` }
      : phase === 'failed'
        ? { eyebrow: 'Not finished', title: "The plan didn't finish", sub: 'Open TripMate to try again', fact: "The plan didn't finish." }
        : { eyebrow: `Planning ${city}`, title: current.label, sub: nowLine(input.days, active?.label ?? null), fact: input.facts[stepIndex % Math.max(1, input.facts.length)] ?? '' };
  return {
    ...text,
    meta: [input.dateRange, `${tripDays} ${tripDays === 1 ? 'day' : 'days'}`, input.tierName].filter(Boolean).join(' · '),
    stepIndex,
    stepCount: STEP_GROUPS.length,
    startedAt: input.startedAt,
    progress: phase === 'writing' ? Math.min(1, Math.max(0, (input.now - input.startedAt) / (etaAt - input.startedAt))) : 1,
    segments,
    etaAt,
    phase,
    photo: input.photo,
  };
}

export function planActivityStaleAt(props: PlanActivityProps): Date {
  return new Date(props.etaAt + STALE_AFTER_MS);
}
