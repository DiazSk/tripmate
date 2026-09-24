/* Run: node --test src/lib/itineraryPrompt.test.mjs
 *
 * Every prompt here that asks for days back gets a whole corrected day set that replaces the
 * original wholesale, so a field missing from one shape is a field the plan loses. That happened:
 * `SHAPE_HINT` listed the per-day `summary` and the critique and rebalance shapes did not, and a
 * model following its own prescribed shape silently erased every day's narrative. These asserts
 * are what fail if the three shapes drift apart again. */
import assert from "node:assert/strict";
import test from "node:test";
import { deriveFlags } from "./userAnswers.ts";
import {
  buildCritiquePrompt,
  buildGeneratePrompt,
  buildRebalancePrompt,
  buildRefinePrompt,
} from "./itineraryPrompt.ts";

const DAYS = [
  {
    date: "2026-05-01",
    weather: "clear",
    summary: "Temples, then the market.",
    stops: [
      {
        name: "Fushimi Inari",
        lat: 34.96,
        lng: 135.77,
        cost: 0,
        note: "n",
        time: "9:00 AM",
        durationLabel: "2 hours",
        category: "other",
      },
    ],
  },
];

/** Every field a day-returning prompt must name in its response shape. */
const DAY_FIELDS = ["date", "weather", "summary", "lodging", "stops"];

const PROMPTS = {
  generate: () =>
    buildGeneratePrompt({
      destination: "Kyoto",
      startDate: "2026-05-01",
      endDate: "2026-05-03",
      budget: 1500,
      tier: "comfort",
      weather: [],
    }),
  critique: () =>
    buildCritiquePrompt({ itinerary: { tier: "comfort", days: DAYS }, budget: 1500 }),
  rebalance: () =>
    buildRebalancePrompt({
      destination: "Kyoto",
      remainingDays: DAYS,
      remainingBudget: 500,
      tier: "comfort",
    }),
};

for (const [name, build] of Object.entries(PROMPTS)) {
  test(`the ${name} prompt names every day field in its response shape`, () => {
    const prompt = build();
    for (const field of DAY_FIELDS) {
      assert.ok(
        prompt.includes(`"${field}"`),
        `the ${name} prompt never mentions "${field}" — a day-returning shape that omits it loses it`
      );
    }
  });
}

test("all three prompts ask for the identical day shape", () => {
  // The literal itself, so a field added to one and not the others fails here rather than in a
  // traveller's plan. Extracted from the generate prompt, which has always been the complete one.
  const generate = PROMPTS.generate();
  const start = generate.indexOf('{"date":"YYYY-MM-DD"');
  assert.ok(start > 0, "could not find the day shape in the generate prompt");
  const dayShape = generate.slice(start, generate.indexOf("}]}", start) + 1);
  assert.ok(dayShape.includes('"summary"'), "the extracted shape should carry summary");
  assert.ok(PROMPTS.critique().includes(dayShape), "critique's day shape differs from generate's");
  assert.ok(PROMPTS.rebalance().includes(dayShape), "rebalance's day shape differs from generate's");
});

test("a preferences object missing `tags` does not take the generation down", () => {
  // `POST /api/itinerary` spreads an unvalidated body, so `tags` is typed as required and is not
  // guaranteed to be there. Reaching `.length` on undefined threw an unhandled TypeError 26
  // seconds into a real generation — after the context call had already been paid for — and the
  // traveller was told "The planner didn't finish."
  const build = (preferences) =>
    buildGeneratePrompt({
      destination: "Kyoto",
      startDate: "2026-05-01",
      endDate: "2026-05-03",
      budget: 1500,
      tier: "comfort",
      weather: [],
      preferences,
    });

  assert.doesNotThrow(() => build({ vibe: "relaxed" }));
  assert.doesNotThrow(() => build({}));
  // A vibe with no tags still reaches the traveller.
  assert.match(build({ vibe: "relaxed" }), /relaxed/);
  // Neither tags nor vibe is the same as no preferences at all: the block is omitted.
  assert.equal(build({}).includes("Traveler preferences:"), false);
  // And the normal shape is unchanged.
  assert.match(build({ tags: ["Food & Drink"], vibe: null }), /Food & Drink/);
});

test("the generate prompt states which constraint wins when two conflict", () => {
  const prompt = buildGeneratePrompt({
    destination: "Kyoto",
    startDate: "2026-09-19",
    endDate: "2026-09-22",
    budget: 3000,
    tier: "mid-range",
    weather: [],
  });
  assert.match(prompt, /when two of these conflict/i);
  // The ordering itself, not just the fact that an ordering exists.
  assert.ok(
    prompt.indexOf("Fixed commitments") < prompt.indexOf("Primary (starred) interests"),
    "commitments must be listed above interests"
  );
  assert.ok(
    prompt.indexOf("Safety and accessibility") < prompt.indexOf("Traveler profile"),
    "accessibility must be listed above pace"
  );
});

// --- refine carries the same stated requirements as generate ------------------------------------

const bareAnswers = (over) => ({
  purpose: "",
  explorerStyle: "mixed",
  group: "solo",
  energy: "moderate",
  crowds: "mixed",
  budget: 1500,
  priorities: [],
  topPriorities: [],
  selectedPois: [],
  customPois: [],
  ...over,
});

const refineBase = {
  destination: "Kyoto",
  startDate: "2026-05-01",
  endDate: "2026-05-03",
  budget: 1500,
  previousItinerary: { tier: "comfort", days: DAYS },
  feedback: "Add more food stops.",
};

test("a refine prompt carries a named must-include and a named exclusion", () => {
  const prompt = buildRefinePrompt({
    ...refineBase,
    answers: bareAnswers({ mustInclude: ["Nishiki Market"], avoid: ["nightclubs"] }),
  });
  assert.match(
    prompt,
    /Must include, and these are requirements rather than preferences: Nishiki Market/
  );
  assert.match(prompt, /Do not include: nightclubs/);
});

test("a refine prompt carries the precedence order — \u00a70 governs edits too", () => {
  // A refine regenerates whole days, so it needs the same answer to "what wins when two valid
  // rules disagree" that the generate prompt gets.
  assert.match(buildRefinePrompt(refineBase), /this is the order that decides it, highest first/);
});

test("a refine call with nothing stated is byte-identical to a call that never passed answers", () => {
  // Mirrors formatTravelLegs's own "absent logistics leave the prompt byte-identical" contract:
  // a traveler who named nothing must not change a single byte of what the model sees, and a
  // caller that predates `answers` entirely (omitting the key) must land on the exact same prompt
  // as one that passes it with nothing stated.
  const withoutAnswersKey = buildRefinePrompt(refineBase);
  const withEmptyAnswers = buildRefinePrompt({ ...refineBase, answers: bareAnswers() });
  assert.equal(withoutAnswersKey, withEmptyAnswers);
  assert.doesNotMatch(withoutAnswersKey, /Stated requirements/);
});

/* --- §3a's party basis, on both halves of the legacy path ---
 *
 * A stop's cost is what the whole party pays, and every surface that reads it — `tripSpend`,
 * `BudgetBar`, `evaluateBudget` — sums it with no multiplier. The critique checklist used to ask
 * for "per-person costs multiplied by party size" while `formatTravelerProfile` spliced in
 * "Party of N" right above it, so a $3,200 family plan against a $4,000 budget was computed as
 * $12,800 and came back with stops stripped. These two asserts are the pair: the generator must
 * state the basis, and the critique must not multiply. */

test("the generate prompt states that a stop's cost is the whole party's", () => {
  assert.match(PROMPTS.generate(), /WHOLE party pays there, never one person's share/);
});

test("the critique prompt never asks for costs to be multiplied by party size", () => {
  const prompt = buildCritiquePrompt({
    itinerary: { tier: "comfort", days: DAYS },
    budget: 1500,
    // The multiplier and the party size in one prompt is the whole shape of the defect: this is
    // what `formatTravelerProfile` emits for a family of four.
    resolvedFlags: deriveFlags(bareAnswers({ group: "family_with_kids", party: { adults: 2, children: 2 } })),
  });
  assert.match(prompt, /Party of 4/, "the party size is in the prompt — that is half of the defect");
  assert.doesNotMatch(prompt, /multipl/i, "and nothing in it may ask for the costs to be scaled by it");
  assert.match(prompt, /party total it already is/);
});
