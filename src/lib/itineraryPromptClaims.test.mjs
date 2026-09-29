import test from "node:test";
import assert from "node:assert/strict";

import { buildGeneratePrompt } from "./itineraryPrompt.ts";

const base = {
  destination: "Kyoto, Japan",
  startDate: "2027-04-02",
  endDate: "2027-04-09",
  budget: 2600,
  tier: "midrange",
};

const withWeather = [{
  date: "2027-04-02", tempMaxC: 18, tempMinC: 9, historical: false,
  precipitationProbability: 10, humidity: 55, weatherCode: 1,
  sunrise: "2027-04-02T05:40", sunset: "2027-04-02T18:12",
}];

/**
 * The defect: `formatWeather` reported "No weather data available." while the response shape
 * still required `"weather"` on every day, so the planner invented one — a real stored Lisbon
 * day reads "Pleasant autumn day, 18.9-23.5°C, mostly sunny".
 */
test("with no forecast, the shape does not ask for a weather field", () => {
  const p = buildGeneratePrompt({ ...base, weather: [] });
  assert.ok(!p.includes('"weather":"short weather summary"'), "weather field still demanded");
  assert.ok(p.includes("No weather data is available for these dates."));
  assert.ok(!p.includes("Use the weather to favor indoor activities"), "weather guidance with no weather");
});

test("with a forecast, the field and the guidance both come back", () => {
  const p = buildGeneratePrompt({ ...base, weather: withWeather });
  assert.ok(p.includes('"weather":"short weather summary"'));
  assert.ok(p.includes("Use the weather to favor indoor activities"));
});

test("the claims policy is always present, forecast or not", () => {
  for (const weather of [[], withWeather]) {
    const p = buildGeneratePrompt({ ...base, weather });
    assert.match(p, /Never state as fact anything you were not given/);
    assert.match(p, /No sunrise, sunset, golden-hour or daylight claim/);
    assert.match(p, /No claim about how busy, quiet, crowded or queued/);
  }
});

test("no emoji is asked for, and none is used as an example", () => {
  const p = buildGeneratePrompt({ ...base, weather: withWeather });
  assert.ok(!/tasteful emoji/i.test(p), "still asking for emoji");
  assert.match(p, /No emoji anywhere in the plan/);
  // The instruction is worthless if the prompt itself demonstrates emoji.
  assert.ok(!/\p{Extended_Pictographic}/u.test(p), "the prompt contains an emoji");
});

/**
 * The leak this guards: generation omits `weather` because there is no forecast, and then the
 * critique or rebalance prompt asks for it back. The model obliges, the revision reintroduces an
 * invented forecast, and it arrives on the second pass where nobody is watching. All three
 * shapes have to move together.
 */
const dryDays = [{
  date: "2027-04-02",
  summary: "Temples, then the market.",
  stops: [{ name: "Fushimi Inari", lat: 34.96, lng: 135.77, cost: 0, note: "", time: "9:00 AM", durationLabel: "2 hours", category: "other" }],
}];

test("a plan with no weather is not handed the field back by the revision passes", async () => {
  const { buildCritiquePrompt, buildRebalancePrompt } = await import("./itineraryPrompt.ts");
  const critique = buildCritiquePrompt({ itinerary: { tier: "midrange", days: dryDays }, budget: 2600 });
  const rebalance = buildRebalancePrompt({
    destination: "Kyoto", remainingDays: dryDays, remainingBudget: 800, tier: "midrange",
  });
  for (const [name, p] of [["critique", critique], ["rebalance", rebalance]]) {
    assert.ok(!p.includes('"weather":"short weather summary"'), `${name} asks for weather back`);
  }
});

test("a plan that does carry weather keeps it through the revision passes", async () => {
  const { buildCritiquePrompt } = await import("./itineraryPrompt.ts");
  const wet = [{ ...dryDays[0], weather: "clear" }];
  const p = buildCritiquePrompt({ itinerary: { tier: "midrange", days: wet }, budget: 2600 });
  assert.ok(p.includes('"weather":"short weather summary"'), "a day with weather lost the field");
});

/**
 * **An instruction that forbids something while demonstrating it teaches the demonstration.**
 *
 * Measured, not theorised. A real run produced "arrive early to avoid crowds on the trails"
 * while the claims policy forbade exactly that in plain words — because the stop-note
 * instruction's own model answer was "go before 10am to beat the crowds". The emoji rule had
 * the identical failure before its example was cleaned.
 *
 * So this scans the examples rather than the prose: everything the prompt offers after "e.g."
 * as a thing to imitate. The policy itself must name the forbidden words, and does; an example
 * must not contain them.
 */
test("no example in the prompt demonstrates a claim the policy forbids", () => {
  const p = buildGeneratePrompt({ ...base, weather: withWeather });

  // Each `e.g. "…"` in the prompt, which is the part a model copies.
  const examples = [...p.matchAll(/e\.g\.\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(examples.length >= 3, `expected several examples, found ${examples.length}`);

  const forbidden =
    /\b(crowds?|crowded|quiet|uncrowded|busy|queue|beat the|avoid the|sunset|sunrise|dawn|dusk|golden hour|sunny|rainy|mild weather)\b/i;
  for (const ex of examples) {
    const hit = ex.match(forbidden);
    assert.ok(!hit, `an example demonstrates "${hit?.[0]}", which the policy forbids: "${ex}"`);
  }
});
