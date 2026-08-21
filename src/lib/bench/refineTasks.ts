import type { BenchFixture } from "./fixtures";
import type { TripSummary, UserAnswers } from "../types";

/**
 * One edit to ask of every model, against the fixture's frozen `baseItinerary`.
 *
 * Three archetypes, each isolating a failure mode the generation benchmark cannot see:
 *   retime  — day-scoped index arithmetic over a compacted itinerary
 *   add     — scope adherence and the no-duplicate-stop rule
 *   ask     — restraint: editPrompt.ts:152 requires a question to return ops: []
 */
export interface RefineTask {
  id: string;
  /** What the traveler types. */
  message: string;
  /** Day-scoped chat when set, whole-trip when omitted — mirrors focus.open(dayIndex, "trip"). */
  dayIndex?: number;
  /** One line on what this probes — shown in the UI beside the fixture's `covers`. */
  covers: string;
  expect: {
    /** False for a question. Changing a plan someone only asked about is the failure. */
    opsExpected: boolean;
    /** Days the patch may touch. Omitted = any. */
    allowedDays?: number[];
  };
}

/**
 * Keyed by fixture id so frozen fixture data and editable task data stay in separate files.
 *
 * Both mutating tasks use dayIndex 1, not 1 and 2 as an earlier draft had it. `lisbon-solo-offbeat`
 * and `bangkok-solo-degraded` are 3-day trips, so dayIndex 2 is their departure day — asking a model
 * to add a dinner there invites a correct decline, and `patch_restraint` scores
 * `opsEmitted > 0 === expect.opsExpected`, so that correct refusal would be recorded as a failure.
 * dayIndex 1 is a middle day for every fixture in the set (3-, 4- and 5-day trips alike), so both
 * mutating archetypes land somewhere a real edit is actually expected to happen.
 */
export const REFINE_TASKS: Record<string, RefineTask[]> = {
  "barcelona-access-dietary": [
    {
      id: "retime-day2",
      message: "Day 2 has us on our feet a lot. Can we start later and make it gentler?",
      dayIndex: 1,
      covers: "probes retiming under a step-free constraint that overrides the couple's stated high energy",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "add-day2",
      message: "Add a good vegan dinner to day 2.",
      dayIndex: 1,
      covers: "the only fixture with dietary data (Vegan + severe tree-nut allergy), so a dietary miss is detectable",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "ask-day1-packed",
      message: "Is day 1 too packed?",
      dayIndex: 0,
      covers: "restraint — a question must be answered, not acted on",
      expect: { opsExpected: false },
    },
  ],
  "kyoto-couple-mixed": [
    {
      id: "retime-day2",
      message: "Day 2 feels rushed. Can we start later and make it more relaxed?",
      dayIndex: 1,
      covers: "real opening hours and a closed day constrain what may move",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "add-day2",
      message: "Add a good vegetarian dinner to day 2.",
      dayIndex: 1,
      covers: "in-scope addition without duplicating a stop already in the trip",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "ask-day1-packed",
      message: "Is day 1 too packed?",
      dayIndex: 0,
      covers: "restraint — a question must be answered, not acted on",
      expect: { opsExpected: false },
    },
  ],
  "lisbon-solo-offbeat": [
    {
      id: "retime-day2",
      message: "Day 2 starts too early for me. Push it later and ease the pace.",
      dayIndex: 1,
      covers: "zero anchors, so every stop is model-chosen",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "add-day2",
      message: "Add a late-night food stop to day 2.",
      dayIndex: 1,
      covers: "top priorities are Food + Nightlife",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "ask-day1-packed",
      message: "Is day 1 too packed?",
      dayIndex: 0,
      covers: "restraint — a question must be answered, not acted on",
      expect: { opsExpected: false },
    },
  ],
  "rome-family-slow": [
    {
      id: "retime-day2",
      message: "Day 2 is a lot for the kids. Start later and make it slower.",
      dayIndex: 1,
      covers: "the pace FLOOR is 2 stops/day, so a model that relaxes by deleting stops can breach it",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "add-day2",
      message: "Add a kid-friendly lunch to day 2.",
      dayIndex: 1,
      covers: "in-scope addition without duplicating a stop already in the trip",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "ask-day1-packed",
      message: "Is day 1 too packed?",
      dayIndex: 0,
      covers: "restraint — a question must be answered, not acted on",
      expect: { opsExpected: false },
    },
  ],
  "reykjavik-couple-packed": [
    {
      id: "retime-day2",
      message: "Can day 2 start later?",
      dayIndex: 1,
      covers: "February Reykjavik has very short daylight, so a later start risks running outdoor stops past dusk",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "add-day2",
      message: "Add a good dinner to day 2.",
      dayIndex: 1,
      covers: "in-scope addition without duplicating a stop already in the trip",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "ask-day1-packed",
      message: "Is day 1 too packed?",
      dayIndex: 0,
      covers: "restraint — a question must be answered, not acted on",
      expect: { opsExpected: false },
    },
  ],
  "bangkok-solo-degraded": [
    {
      id: "retime-day2",
      message: "Day 2 feels rushed. Can we start later?",
      dayIndex: 1,
      covers: "holiday and transport data are both unavailable, so the model must not invent either",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "add-day2",
      message: "Add a street-food stop to day 2.",
      dayIndex: 1,
      covers: "in-scope addition without duplicating a stop already in the trip",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "ask-day1-packed",
      message: "Is day 1 too packed?",
      dayIndex: 0,
      covers: "restraint — a question must be answered, not acted on",
      expect: { opsExpected: false },
    },
  ],
  "queenstown-couple-noweather": [
    {
      id: "retime-day2",
      message: "Day 2 starts too early. Push it later and ease the pace.",
      dayIndex: 1,
      covers: "the weather fetch failed entirely, so the model must not state a forecast for the moved stops",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "add-day2",
      message: "Add a good dinner to day 2.",
      dayIndex: 1,
      covers: "in-scope addition without duplicating a stop already in the trip",
      expect: { opsExpected: true, allowedDays: [1] },
    },
    {
      id: "ask-day1-packed",
      message: "Is day 1 too packed?",
      dayIndex: 0,
      covers: "restraint — a question must be answered, not acted on",
      expect: { opsExpected: false },
    },
  ],
};

export function refineTasksFor(fixtureId: string): RefineTask[] {
  return REFINE_TASKS[fixtureId] ?? [];
}

export function findRefineTask(fixtureId: string, taskId: string): RefineTask | undefined {
  return refineTasksFor(fixtureId).find((t) => t.id === taskId);
}

/**
 * The TripSummary `/api/trip-edit` would have loaded from SQLite, derived from the fixture instead.
 *
 * Nothing here is invented: dates come from the frozen dateContext, budget from the frozen
 * userAnswers, destination from the frozen geocode. A literal would be a second source of truth
 * that could drift from what the generation cells saw.
 */
export function benchTripSummary(fixture: BenchFixture): TripSummary {
  const days = fixture.reconciled.rawFetch.dateContext.days;
  return {
    id: `bench-${fixture.id}`,
    destination: fixture.reconciled.rawFetch.destination.region ?? fixture.title,
    startDate: days[0]?.date ?? "",
    endDate: days[days.length - 1]?.date ?? "",
    budget: fixture.reconciled.userAnswers.budget,
  };
}

export function benchUserAnswers(fixture: BenchFixture): UserAnswers {
  return fixture.reconciled.userAnswers;
}
