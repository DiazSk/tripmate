/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/planHealth.test.mjs
 *
 * The one claim this module makes is that its figure is explainable — every point it withholds is
 * a finding the traveler can read. So the tests that matter are not "does it score 94": they are
 * "does a defect land in the right dimension", "does an unrun check score null rather than 100",
 * and "does every finding survive the partition". A silent drop here is a plan that looks sounder
 * than it is, which is the only genuinely dangerous failure this surface has. */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateItinerary } from "./guardrails.ts";
import { planHealth } from "./planHealth.ts";

const stop = (over) => ({
  name: "A museum",
  lat: 35.0,
  lng: 135.7,
  cost: 20,
  note: "",
  time: "9:00 AM",
  durationLabel: "1 hour",
  category: "entry",
  ...over,
});

/** Two nearby stops, an hour apart, well inside any sane budget. Nothing to report. */
const sound = () => ({
  tier: "midrange",
  days: [
    {
      date: "2026-09-14",
      weather: "",
      stops: [stop({}), stop({ name: "A garden", lat: 35.005, lng: 135.705, time: "11:00 AM" })],
    },
  ],
});

const by = (health, key) => health.dimensions.find((d) => d.key === key);

test("a sound plan scores 100 on what could be checked", () => {
  const health = planHealth(sound(), { budget: 2000 });
  assert.equal(health.score, 100);
  assert.equal(by(health, "schedule").score, 100);
  assert.equal(by(health, "budget").score, 100);
  assert.equal(by(health, "load").score, 100);
});

// The whole reason `score` is nullable. A two-stop day with no forecast and no booking has not
// passed the routing, weather or reservations checks — nobody ran them.
test("a check nothing could run scores null, never 100", () => {
  const health = planHealth(sound(), { budget: 2000 });
  assert.equal(by(health, "routing").score, null, "two stops cannot backtrack");
  assert.equal(by(health, "weather").score, null, "no forecast, no outdoor flags");
  assert.equal(by(health, "reservations").score, null, "nothing was booked");
  assert.equal(by(health, "requests").score, null, "nothing was asked for by name");
});

test("every dimension is listed even when it has nothing to say", () => {
  const health = planHealth(sound(), {});
  assert.equal(health.dimensions.length, 7);
  assert.deepEqual(
    health.dimensions.map((d) => d.key),
    ["schedule", "reservations", "budget", "load", "routing", "weather", "requests"]
  );
});

test("an unmeasurable plan scores null overall rather than zero", () => {
  const blank = { tier: "midrange", days: [{ date: "2026-09-14", weather: "", stops: [] }] };
  const health = planHealth(blank, {});
  assert.equal(health.score, null);
  assert.ok(health.dimensions.every((d) => d.score === null));
});

test("going over budget docks budget alone, and carries the finding that did it", () => {
  const over = sound();
  over.days[0].stops[0].cost = 5000;
  const health = planHealth(over, { budget: 100 });
  const budget = by(health, "budget");
  assert.equal(budget.score, 92, "one finding at 8 points");
  assert.equal(budget.findings.length, 1);
  assert.match(budget.findings[0].message, /over your \$100 budget/);
  assert.equal(by(health, "schedule").score, 100, "the schedule is untouched by a price");
});

// §0 rank 1. A leg that cannot reach a BOOKED stop is a reservation about to be missed, and it
// has to show up under Reservations — putting it under Schedule is how somebody reads "Schedule
// 92" and does not phone the restaurant.
test("a booked stop the day cannot reach docks reservations, not schedule", () => {
  const missed = sound();
  missed.days[0].stops[1] = stop({
    name: "Dinner at Den",
    lat: 35.1,
    lng: 135.9,
    time: "10:05 AM",
    timeFlexibility: "FIXED",
  });
  const health = planHealth(missed, { budget: 2000, modes: ["walk"] });
  assert.equal(by(health, "reservations").score, 92);
  assert.match(by(health, "reservations").findings[0].message, /booking at/);
  assert.equal(by(health, "schedule").score, 100);
});

test("an outdoor stop under a wet forecast docks weather", () => {
  const wet = sound();
  wet.days[0].weatherDetail = {
    date: "2026-09-14",
    tempMaxC: 20,
    tempMinC: 12,
    historical: false,
    precipitationProbability: 80,
    humidity: null,
    weatherCode: null,
    sunrise: null,
    sunset: null,
  };
  wet.days[0].stops[1].outdoor = true;
  wet.days[0].stops[0].outdoor = false;
  const weather = by(planHealth(wet, { budget: 2000 }), "weather");
  assert.equal(weather.score, 92, "the indoor stop is not a risk");
  assert.match(weather.findings[0].message, /A garden is outdoors.*80%/);
});

// Last year's figure for the same date is not a claim about this trip, so `weather.ts` writes a
// null probability on the historical fallback and there is nothing here to check.
test("typical-weather days are not scored for rain", () => {
  const typical = sound();
  typical.days[0].weatherDetail = {
    date: "2026-09-14",
    tempMaxC: 20,
    tempMinC: 12,
    historical: true,
    precipitationProbability: null,
    humidity: null,
    weatherCode: null,
    sunrise: null,
    sunset: null,
  };
  typical.days[0].stops[1].outdoor = true;
  assert.equal(by(planHealth(typical, { budget: 2000 }), "weather").score, null);
});

/* The partition invariant. Every finding `evaluateItinerary` produces must land in exactly one
 * dimension — a rule added to guardrails.ts without a home here would otherwise vanish from the
 * panel while still being true of the plan. */
test("no finding is dropped by the partition", () => {
  const broken = {
    tier: "midrange",
    days: [
      {
        date: "2026-09-14",
        weather: "",
        stops: [
          stop({ cost: 9000, durationLabel: "11 hours" }),
          stop({ name: "A garden", lat: 35.4, lng: 136.2, time: "10:05 AM" }),
        ],
      },
    ],
  };
  const options = { budget: 50, modes: ["walk"], mustInclude: ["A shrine"] };
  const health = planHealth(broken, options);
  const partitioned = health.dimensions.flatMap((d) => d.findings);
  const all = evaluateItinerary(broken, options);
  assert.ok(all.length >= 3, "the fixture must actually be broken in several ways");
  assert.equal(partitioned.length, all.length, "every finding has exactly one home");
  assert.deepEqual(new Set(partitioned.map((f) => f.message)), new Set(all.map((f) => f.message)));
});

test("a closed stop counts against Schedule and an empty imported day against Day load", () => {
  const s = (over) => ({ name: "x", lat: 38.7, lng: -9.14, cost: 0, note: "", time: "10:00 AM", durationLabel: "60 min", category: "entry", ...over });
  const health = planHealth(
    {
      origin: "imported",
      days: [
        { date: "2026-11-02", weather: "", stops: [s({ closedDays: ["Mo"] })] },
        { date: "2026-11-03", weather: "", stops: [] },
      ],
    },
    {}
  );
  const dim = (key) => health.dimensions.find((d) => d.key === key);
  assert.ok(dim("schedule").findings.some((f) => f.rule === "closed"));
  assert.ok(dim("load").findings.some((f) => f.rule === "empty"));
});
