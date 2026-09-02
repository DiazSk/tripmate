/* Run: node --test src/lib/itineraryPrompt.test.mjs
 *
 * Every prompt here that asks for days back gets a whole corrected day set that replaces the
 * original wholesale, so a field missing from one shape is a field the plan loses. That happened:
 * `SHAPE_HINT` listed the per-day `summary` and the critique and rebalance shapes did not, and a
 * model following its own prescribed shape silently erased every day's narrative. These asserts
 * are what fail if the three shapes drift apart again. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCritiquePrompt,
  buildGeneratePrompt,
  buildRebalancePrompt,
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
