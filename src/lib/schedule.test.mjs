/* Run: node --test src/lib/schedule.test.mjs
 *
 * The drag-and-drop path has no model call to sanity-check its output, so the arithmetic here is
 * the only thing standing between a dropped stop and a day that claims to be in two places at
 * once. These asserts cover the cases that are easy to get subtly wrong: the insertion index
 * after a lift, the anchor a re-time cascades from, and durations surviving a move. */
import assert from "node:assert/strict";
import test from "node:test";
import { insertionIndexByTime, legMinutes, moveStop, rescheduleDay, travellerTimes } from "./schedule.ts";
import { parseClock } from "./itinerary.ts";
import { evaluateDay, evaluateBudget, evaluateItinerary } from "./guardrails.ts";

/** Two points ~1km apart (walkable) and one ~9km away (transit). */
const NEAR = { lat: 35.0, lng: 135.76 };
const ALSO_NEAR = { lat: 35.008, lng: 135.76 };
const FAR = { lat: 35.08, lng: 135.76 };

const stop = (over = {}) => ({
  name: "x",
  lat: NEAR.lat,
  lng: NEAR.lng,
  cost: 0,
  note: "",
  time: "",
  durationLabel: "1 hour",
  category: "entry",
  ...over,
});

const day = (stops, over = {}) => ({ date: "2026-09-19", weather: "", stops, ...over });

test("legMinutes walks a short hop and takes transit for a long one", () => {
  const near = legMinutes(stop(), stop({ ...ALSO_NEAR }));
  const far = legMinutes(stop(), stop({ ...FAR }));
  assert.ok(near > 0 && near < 20, `short hop should be a short walk, got ${near}`);
  assert.ok(far > near, "9km should cost more than 1km");
});

test("rescheduleDay cascades from the day's earliest time and keeps durations", () => {
  const d = day([
    stop({ name: "A", time: "9:00 AM", durationLabel: "2 hours" }),
    stop({ name: "B", ...ALSO_NEAR, time: "3:00 PM", durationLabel: "45 minutes" }),
  ]);
  const out = rescheduleDay(d);

  assert.equal(out.stops[0].time, "9:00 AM", "anchor is the earliest existing time");
  assert.equal(out.stops[0].durationLabel, "2 hours", "durations are never rewritten");
  // B starts after A's 2 hours plus the walk between them, rounded up to the next 5-minute slot.
  const bLeg = legMinutes(d.stops[0], d.stops[1]);
  const raw = 9 * 60 + 120 + bLeg;
  assert.equal(out.stops[1].time, fmtAfter(Math.ceil(raw / 5) * 5));
  assert.match(out.stops[1].time, /:(00|05|10|15|20|25|30|35|40|45|50|55) /, "lands on a 5-min slot");
  assert.equal(out.stops[1].durationLabel, "45 minutes");
});

test("rescheduleDay falls back to 9 AM when no stop carries a readable time", () => {
  const out = rescheduleDay(day([stop({ name: "A", time: "" }), stop({ name: "B", time: "nope" })]));
  assert.equal(out.stops[0].time, "9:00 AM");
});

test("rescheduleDay leaves an empty day alone", () => {
  const empty = day([]);
  assert.equal(rescheduleDay(empty), empty);
});

test("moveStop reorders within a day and re-times from the anchor", () => {
  const it = {
    tier: "midrange",
    days: [
      day([
        stop({ name: "A", time: "9:00 AM", durationLabel: "1 hour" }),
        stop({ name: "B", ...ALSO_NEAR, time: "11:00 AM", durationLabel: "1 hour" }),
        stop({ name: "C", ...ALSO_NEAR, time: "1:00 PM", durationLabel: "1 hour" }),
      ]),
    ],
  };
  // Drag C to the top.
  const out = moveStop(it, { dayIndex: 0, stopIndex: 2 }, { dayIndex: 0, stopIndex: 0 });
  assert.deepEqual(out.days[0].stops.map((s) => s.name), ["C", "A", "B"]);
  assert.equal(out.days[0].stops[0].time, "9:00 AM", "the day still starts when it did");
  // Original is untouched — the caller decides whether to commit.
  assert.deepEqual(it.days[0].stops.map((s) => s.name), ["A", "B", "C"]);
});

test("moveStop across days re-times BOTH days and drops the stop at the asked-for index", () => {
  const it = {
    tier: "midrange",
    days: [
      day([
        stop({ name: "A", time: "9:00 AM" }),
        stop({ name: "B", ...ALSO_NEAR, time: "11:00 AM" }),
      ]),
      day([stop({ name: "C", time: "10:00 AM" })], { date: "2026-09-20" }),
    ],
  };
  const out = moveStop(it, { dayIndex: 0, stopIndex: 1 }, { dayIndex: 1, stopIndex: 0 });

  assert.deepEqual(out.days[0].stops.map((s) => s.name), ["A"]);
  assert.deepEqual(out.days[1].stops.map((s) => s.name), ["B", "C"]);
  // Day 2's anchor was C's 10:00 AM, and B now takes that slot.
  assert.equal(out.days[1].stops[0].time, "10:00 AM");
  assert.ok(out.days[1].stops[1].time !== "10:00 AM", "C moved to make room for B");
});

test("moveStop is a no-op on a reference that doesn't exist", () => {
  const it = { tier: "midrange", days: [day([stop({ name: "A" })])] };
  assert.equal(moveStop(it, { dayIndex: 9, stopIndex: 0 }, { dayIndex: 0, stopIndex: 0 }), it);
  assert.equal(moveStop(it, { dayIndex: 0, stopIndex: 5 }, { dayIndex: 0, stopIndex: 0 }), it);
});

test("insertionIndexByTime slots a stop by clock rather than appending blindly", () => {
  const d = day([
    stop({ name: "morning", time: "9:00 AM" }),
    stop({ name: "evening", time: "7:00 PM" }),
  ]);
  assert.equal(insertionIndexByTime(d, stop({ time: "1:00 PM" })), 1);
  assert.equal(insertionIndexByTime(d, stop({ time: "8:00 PM" })), 2);
  assert.equal(insertionIndexByTime(d, stop({ time: "7:00 AM" })), 0);
  assert.equal(insertionIndexByTime(d, stop({ time: "" })), 2, "no time = append");
});

// --- guardrails ------------------------------------------------------------------------------

test("evaluateDay ignores a shortfall inside the estimate's own margin", () => {
  // Neighbouring stops ~2 min apart, back to back: technically 0 min for a 2 min walk, but not
  // worth a warning.
  const d = day([
    stop({ name: "A", time: "9:00 AM", durationLabel: "1 hour" }),
    stop({ name: "B", lat: NEAR.lat + 0.001, time: "10:00 AM", durationLabel: "1 hour" }),
  ]);
  assert.deepEqual(evaluateDay(d, 0).filter((f) => f.rule === "travel"), []);
});

test("evaluateDay flags a leg that cannot fit the gap left for it", () => {
  const d = day([
    stop({ name: "Far side", ...FAR, time: "9:00 AM", durationLabel: "1 hour" }),
    stop({ name: "Other side", time: "10:05 AM", durationLabel: "1 hour" }),
  ]);
  const [finding] = evaluateDay(d, 0);
  assert.equal(finding.rule, "travel");
  assert.equal(finding.dayIndex, 0);
  assert.match(finding.message, /Far side to Other side takes about \d+ min/);
});

test("evaluateDay flags overlapping stops separately from travel", () => {
  const d = day([
    stop({ name: "A", time: "9:00 AM", durationLabel: "3 hours" }),
    stop({ name: "B", ...ALSO_NEAR, time: "10:00 AM", durationLabel: "1 hour" }),
  ]);
  const rules = evaluateDay(d, 0).map((f) => f.rule);
  assert.ok(rules.includes("overlap"), `expected an overlap finding, got ${rules}`);
});

test("evaluateDay stays quiet on a day that fits", () => {
  const d = rescheduleDay(
    day([
      stop({ name: "A", time: "9:00 AM", durationLabel: "1 hour" }),
      stop({ name: "Lunch", ...ALSO_NEAR, category: "food", durationLabel: "1 hour" }),
      stop({ name: "B", ...ALSO_NEAR, durationLabel: "1 hour" }),
    ])
  );
  assert.deepEqual(evaluateDay(d, 0), [], "a freshly re-timed day is feasible by construction");
});

test("evaluateDay flags a long day with no break, and stays quieter when there is one", () => {
  const stops = [
    stop({ name: "A", time: "7:00 AM", durationLabel: "4 hours", category: "entry" }),
    stop({ name: "B", ...ALSO_NEAR, time: "12:00 PM", durationLabel: "4 hours", category: "entry" }),
    stop({ name: "C", ...ALSO_NEAR, time: "5:00 PM", durationLabel: "2 hours", category: "entry" }),
  ];
  // 7 AM to 7 PM = 12h. Durations all read as breaks, so this only fires because 12h is past the
  // grace a day with breaks gets.
  const withBreaks = evaluateDay(day(stops), 0).filter((f) => f.rule === "pace");
  assert.equal(withBreaks.length, 1);
  // **Exact, not hedged.** A day's length is a subtraction over two clock times already in the
  // plan, so "about" would say a calculation happened rather than that the figure could be wrong.
  assert.match(withBreaks[0].message, /runs 7:00 AM to 7:00 PM: 12 hr, even with breaks in it\./);
  assert.doesNotMatch(withBreaks[0].message, /about/);

  // 10h with breaks sits inside the grace and stays silent.
  const tolerable = day([
    stop({ name: "A", time: "9:00 AM", durationLabel: "2 hours", category: "food" }),
    stop({ name: "B", ...ALSO_NEAR, time: "5:00 PM", durationLabel: "2 hours" }),
  ]);
  assert.deepEqual(
    evaluateDay(tolerable, 0).filter((f) => f.rule === "pace"),
    []
  );

  // Same span, all short hops with nothing to sit down for.
  const relentless = day([
    stop({ name: "A", time: "7:00 AM", durationLabel: "15 minutes" }),
    stop({ name: "Z", ...ALSO_NEAR, time: "6:45 PM", durationLabel: "15 minutes" }),
  ]);
  const found = evaluateDay(relentless, 0).filter((f) => f.rule === "pace");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /no meal or rest stop/);
  assert.doesNotMatch(found[0].message, /about/);
});

test("evaluateBudget reports the overshoot only when there is one", () => {
  const it = {
    tier: "midrange",
    days: [day([stop({ cost: 300 })], { lodging: { name: "h", cost: 300, note: "" } })],
  };
  assert.deepEqual(evaluateBudget(it, 700), []);
  const [over] = evaluateBudget(it, 500);
  assert.equal(over.rule, "budget");
  assert.equal(over.dayIndex, null);
  assert.match(over.message, /\$600, \$100 over your \$500 budget/);
  assert.deepEqual(evaluateBudget(it, 0), [], "no budget stated = nothing to check");
});

test("evaluateItinerary reports days the traveler is no longer looking at", () => {
  const it = {
    tier: "midrange",
    days: [
      // Deliberately off the default coordinate: every other stop here sits on NEAR, and the
      // duplicate check reads two stops within ~150m of each other as one place written twice.
      day([stop({ name: "fine", ...ALSO_NEAR, time: "9:00 AM" })]),
      day(
        [
          stop({ name: "Far", ...FAR, time: "9:00 AM", durationLabel: "1 hour" }),
          stop({ name: "Near", time: "10:05 AM", durationLabel: "1 hour" }),
        ],
        { date: "2026-09-20" }
      ),
    ],
  };
  const found = evaluateItinerary(it, { budget: 10000 });
  assert.equal(found.length, 1);
  assert.equal(found[0].dayIndex, 1, "the finding names the day it belongs to");
});

/** Helper mirroring formatClock for expected values. */
function fmtAfter(minutes) {
  const total = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(total % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

test("moveStop works BACKWARDS across days, not just forwards", () => {
  // The UI bug this covers was in the drop targets, not here — but a later-day-to-earlier-day move
  // is the case that went unexercised, so it gets an assert of its own.
  const it = {
    tier: "midrange",
    days: [
      day([stop({ name: "A", time: "9:00 AM", durationLabel: "1 hour" })]),
      day(
        [
          stop({ name: "B", ...ALSO_NEAR, time: "10:00 AM", durationLabel: "1 hour" }),
          stop({ name: "C", ...ALSO_NEAR, time: "2:00 PM", durationLabel: "1 hour" }),
        ],
        { date: "2026-09-20" }
      ),
    ],
  };
  // Day 2's first stop dragged back onto day 1.
  const out = moveStop(it, { dayIndex: 1, stopIndex: 0 }, { dayIndex: 0, stopIndex: 1 });
  assert.deepEqual(out.days[0].stops.map((s) => s.name), ["A", "B"]);
  assert.deepEqual(out.days[1].stops.map((s) => s.name), ["C"]);
  assert.equal(out.days[0].stops[0].time, "9:00 AM", "day 1 keeps its start");
  assert.ok(out.days[0].stops[1].time !== "", "the arrival is re-timed onto day 1");
  // Day 2 re-anchors on what's left of it rather than keeping a hole where B was.
  assert.equal(out.days[1].stops[0].time, "2:00 PM");
});

test("keepTimeOf keeps a traveller's own time and starts an untimed morning at 9:00", () => {
  // Without keepTimeOf the anchor is the day's earliest time — 2:00 PM here — which would start
  // stop "a" in the afternoon although nobody said so.
  const out = rescheduleDay(
    day([
      stop({ name: "a", time: "", durationLabel: "60 min" }),
      stop({ name: "b", time: "2:00 PM", durationLabel: "60 min" }),
      stop({ name: "c", time: "", durationLabel: "60 min" }),
    ]),
    { keepTimeOf: (s) => s.name === "b" }
  );
  assert.equal(out.stops[0].time, "9:00 AM");
  assert.equal(out.stops[1].time, "2:00 PM");
  assert.ok(parseClock(out.stops[2].time) >= 15 * 60, out.stops[2].time);
});

test("keepTimeOf starts the day at the first stop's own time when the traveller gave one", () => {
  // Passes before and after the change — kept so the anchor rule is pinned from both sides.
  const out = rescheduleDay(
    day([
      stop({ name: "a", time: "10:30 AM", durationLabel: "60 min" }),
      stop({ name: "b", time: "", durationLabel: "60 min" }),
    ]),
    { keepTimeOf: (s) => s.name === "a" }
  );
  assert.equal(out.stops[0].time, "10:30 AM");
  assert.ok(parseClock(out.stops[1].time) >= 11 * 60 + 30, out.stops[1].time);
});

test("travellerTimes pins only the times a traveller gave, and only on imported plans", () => {
  const keep = travellerTimes({ origin: "imported" });
  assert.equal(keep({ estimated: ["time", "duration"] }), false);
  assert.equal(keep({ estimated: ["duration"] }), true);
  assert.equal(travellerTimes({ origin: "generated" }), undefined);
  assert.equal(travellerTimes({}), undefined);
});

test("untimed stops before a traveller's timed one finish before it, instead of overlapping it", () => {
  // Starting the café at 9:00 with a 45-minute estimate ran it into the traveller's 9:30 museum,
  // and the overlap that opened the trip was one TripMate invented — whose first offered repair
  // then moved the traveller's own time. The run is scheduled back from the time they gave.
  const out = rescheduleDay(
    day([
      stop({ name: "cafe", time: "", durationLabel: "45 min" }),
      stop({ name: "museum", time: "9:30 AM", durationLabel: "60 min" }),
    ]),
    { keepTimeOf: (s) => s.name === "museum" }
  );
  assert.equal(out.stops[1].time, "9:30 AM");
  const cafeEnds = parseClock(out.stops[0].time) + 45 + legMinutes(out.stops[0], out.stops[1]);
  assert.ok(cafeEnds <= 9 * 60 + 30, `café runs until minute ${cafeEnds}`);
  assert.deepEqual(evaluateDay(out, 0).filter((f) => f.rule === "overlap" || f.rule === "travel"), []);
});
