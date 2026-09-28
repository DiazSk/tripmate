/* Run: node --test src/lib/guardrailFixes.test.mjs
 *
 * These repairs rewrite somebody's plan on one tap, with no model and no confirmation step
 * beyond the label. Every case below is one where being wrong is quiet: a time that moves the
 * wrong stop, a fix that closes the named leg by breaking the one before it, or a booked table
 * that shifts anyway. */
import assert from "node:assert/strict";
import test from "node:test";
import { repairsFor } from "./guardrailFixes.ts";
import { evaluateDay } from "./guardrails.ts";

const stop = (name, time, durationLabel, extra = {}) => ({
  name,
  // ~1.5km apart along a line: far enough that a hop costs real minutes.
  lat: 38.71,
  lng: -9.13,
  cost: 0,
  note: "",
  time,
  durationLabel,
  category: "entry",
  ...extra,
});

/** Lunch runs to 2:00, the castle is at 2:05, and they are 2km apart — the leg cannot fit. */
const tight = (extra = {}) => ({
  days: [
    {
      date: "2026-10-22",
      weather: "",
      stops: [
        stop("Lunch", "1:00 PM", "1 hour"),
        { ...stop("Castle", "2:05 PM", "2 hours"), lat: 38.73, lng: -9.15, ...extra },
      ],
    },
  ],
});

const findingFor = (itinerary) =>
  evaluateDay(itinerary.days[0], 0).find((f) =>
    ["travel", "overlap", "commitment"].includes(f.rule)
  );

test("the leg the check raised is actually closed", () => {
  const plan = tight();
  const finding = findingFor(plan);
  assert.ok(finding, "the fixture must produce a leg finding");

  const repairs = repairsFor(plan, finding);
  assert.ok(repairs.length > 0, "a leg that does not fit must offer a way out");

  for (const repair of repairs) {
    const left = evaluateDay(repair.next.days[0], 0).filter((f) =>
      ["travel", "overlap", "commitment"].includes(f.rule)
    );
    assert.deepEqual(left, [], `"${repair.label}" left the leg unfixed`);
  }
});

test("both ways out are offered, and each names the clock it produces", () => {
  const repairs = repairsFor(tight(), findingFor(tight()));
  assert.equal(repairs.length, 2);
  assert.match(repairs[0].label, /^Push Castle back \d+ min, to \d+:\d\d (AM|PM)$/);
  assert.match(repairs[1].label, /^Start Lunch \d+ min earlier, at \d+:\d\d (AM|PM)$/);
});

/* The promise the whole booked-stop feature rests on. A repair that would move one is not
 * offered at all, rather than offered and then refused. */
test("nothing booked is ever moved", () => {
  const plan = tight({ timeFlexibility: "FIXED" });
  const repairs = repairsFor(plan, findingFor(plan));
  assert.ok(repairs.length > 0, "the stop before a booking can still move");
  for (const repair of repairs) {
    assert.equal(
      repair.next.days[0].stops[1].time,
      "2:05 PM",
      `"${repair.label}" moved a booked stop`
    );
    assert.match(repair.label, /^Start Lunch/);
  }
});

test("a day where neither end can move offers nothing rather than something wrong", () => {
  const plan = tight({ timeFlexibility: "FIXED" });
  plan.days[0].stops[0].timeFlexibility = "FIXED";
  assert.deepEqual(repairsFor(plan, findingFor(plan)), []);
});

/* Pulling a stop earlier buys minutes from the gap in front of it. Where there is no room in
 * front, that trade breaks the leg behind — and swapping a named conflict for an unnamed one
 * is worse than offering nothing. */
test("a repair that would tighten another leg is withheld", () => {
  const plan = {
    days: [
      {
        date: "2026-10-22",
        weather: "",
        stops: [
          { ...stop("Museum", "11:00 AM", "1 hour"), lat: 38.69, lng: -9.11 },
          stop("Lunch", "12:10 PM", "1 hour"),
          { ...stop("Castle", "1:15 PM", "2 hours"), lat: 38.73, lng: -9.15 },
        ],
      },
    ],
  };
  const finding = evaluateDay(plan.days[0], 0).find((f) => f.stopIndex === 2);
  assert.ok(finding, "the Lunch to Castle leg must be the one raised");

  for (const repair of repairsFor(plan, finding)) {
    // Whatever is offered, the Museum to Lunch leg must be no worse than it started.
    const after = evaluateDay(repair.next.days[0], 0).filter((f) => f.stopIndex === 1);
    assert.deepEqual(after, [], `"${repair.label}" broke the leg before it`);
  }
});

test("a leg that already fits, and a rule that is not a leg, offer nothing", () => {
  const fine = {
    days: [
      {
        date: "2026-10-22",
        weather: "",
        stops: [stop("Lunch", "1:00 PM", "1 hour"), stop("Cafe", "4:00 PM", "1 hour")],
      },
    ],
  };
  assert.deepEqual(
    repairsFor(fine, { rule: "travel", dayIndex: 0, stopIndex: 1, message: "" }),
    []
  );
  assert.deepEqual(
    repairsFor(tight(), { rule: "weather", dayIndex: 0, stopIndex: 1, message: "" }),
    []
  );
  // Trip-wide findings name no stop, so there is no leg to repair.
  assert.deepEqual(
    repairsFor(tight(), { rule: "budget", dayIndex: null, message: "" }),
    []
  );
});
