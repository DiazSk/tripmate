/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/daySlotting.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VISIT_MIN,
  SLOT_WINDOWS,
  formatClock,
  parseDurationLabel,
  planSlot,
  suggestTimeOfDay,
} from "./daySlotting.ts";
import { parseClockTime, timeOfDay } from "./timeOfDay.ts";

const stop = (name, time, durationLabel = "1 hour") => ({
  name,
  time,
  durationLabel,
  lat: 0,
  lng: 0,
  cost: 0,
  note: "",
  category: "other",
});

const at = (plan) => parseClockTime(plan.time);

test("duration labels are read in the shapes the model actually writes", () => {
  assert.equal(parseDurationLabel("1 hour"), 60);
  assert.equal(parseDurationLabel("2 hours"), 120);
  assert.equal(parseDurationLabel("45 min"), 45);
  assert.equal(parseDurationLabel("45 minutes"), 45);
  assert.equal(parseDurationLabel("1.5 hours"), 90);
  assert.equal(parseDurationLabel("2h 30m"), 150);
  assert.equal(parseDurationLabel("90 mins"), 90);
});

test("a duration that is not one comes back null rather than a guess", () => {
  for (const junk of ["", null, undefined, "all afternoon", "a while", "—"]) {
    assert.equal(parseDurationLabel(junk), null, `for ${JSON.stringify(junk)}`);
  }
  // Past a day is a data error, not a visit — letting it through would push the rest off the clock.
  assert.equal(parseDurationLabel("3 days"), null);
  assert.equal(parseDurationLabel("30 hours"), null);
});

test("clock formatting matches the plan's own format, including the two ends", () => {
  assert.equal(formatClock(0), "12:00 AM");
  assert.equal(formatClock(12 * 60), "12:00 PM");
  assert.equal(formatClock(9 * 60 + 5), "9:05 AM");
  assert.equal(formatClock(14 * 60 + 30), "2:30 PM");
  assert.equal(formatClock(23 * 60 + 59), "11:59 PM");
});

test("a place is suggested by what it is", () => {
  assert.equal(suggestTimeOfDay({ category: "cafe", name: "Fábrica" }), "Morning");
  assert.equal(suggestTimeOfDay({ category: "bar", name: "A Ginjinha" }), "Evening");
  assert.equal(suggestTimeOfDay({ category: "restaurant", name: "Taberna" }), "Evening");
  assert.equal(suggestTimeOfDay({ category: "museum", name: "Gulbenkian" }), "Afternoon");
  assert.equal(suggestTimeOfDay({ category: "park", name: "Estrela" }), "Afternoon");
  // The free-text bucket is the biggest one and gets the band that is never closed.
  assert.equal(suggestTimeOfDay({ category: "place", name: "Miradouro" }), "Afternoon");
  assert.equal(suggestTimeOfDay({}), "Afternoon");
});

test("the name outranks the category, because a category is a coarse bucket", () => {
  assert.equal(suggestTimeOfDay({ category: "restaurant", name: "Brunch Club" }), "Morning");
  assert.equal(suggestTimeOfDay({ category: "shop", name: "Time Out Night Market" }), "Evening");
  assert.equal(suggestTimeOfDay({ category: "place", name: "Rooftop Bar" }), "Evening");
});

test("name hints match whole words only", () => {
  // "set" inside "Sunset" must not fire; "Sunset" itself must.
  assert.equal(suggestTimeOfDay({ category: "cafe", name: "Sunset Diner" }), "Evening");
  // "winery" is not "wine"; without word boundaries the evening list would swallow it anyway, so
  // this pins the behaviour rather than the preference.
  assert.equal(suggestTimeOfDay({ category: "cafe", name: "Winery Lane Coffee" }), "Morning");
});

test("a stop lands at the end of its own part of the day, moving nothing", () => {
  const stops = [stop("Breakfast", "9:00 AM"), stop("Museum", "10:30 AM"), stop("Dinner", "8:00 PM")];
  const plan = planSlot(stops, "Afternoon");
  // After the morning pair, before dinner.
  assert.equal(plan.index, 2);
  assert.equal(plan.time, "2:30 PM");
  assert.equal(plan.tight, false);
});

test("a morning that already runs late gets the next free time, not the anchor", () => {
  const stops = [stop("Market", "9:00 AM", "2 hours")];
  const plan = planSlot(stops, "Morning");
  assert.equal(plan.index, 1);
  // 9:00 + 2h + a 15 minute buffer, rather than insisting on the 10:00 anchor and double-booking.
  assert.equal(plan.time, "11:15 AM");
  assert.equal(plan.tight, false);
});

test("a stop goes at the end of its part of the day, not into the widest gap", () => {
  // Predictability beats optimality here: add three cafés to an afternoon and they come out in the
  // order they were added, rather than the plan re-sorting itself around a hunt for room.
  const stops = [stop("Lunch", "12:30 PM", "1 hour"), stop("Show", "4:00 PM")];
  const plan = planSlot(stops, "Afternoon", 60);
  assert.equal(plan.index, 2, "after both afternoon stops");
});

test("the next stop's start is respected, not just the previous one's end", () => {
  const stops = [stop("Lunch", "12:30 PM", "1 hour"), stop("Dinner", "7:00 PM")];
  const plan = planSlot(stops, "Afternoon", 60);
  assert.equal(plan.index, 1);
  const minutes = at(plan);
  assert.ok(minutes >= 13 * 60 + 45, `${plan.time} must clear lunch plus the buffer`);
  assert.ok(minutes + 60 + 15 <= 19 * 60, `${plan.time} must finish before dinner, with a buffer`);
});

test("a visit that cannot clear the next stop is reported tight", () => {
  const stops = [stop("Late lunch", "3:00 PM", "1 hour"), stop("Dinner", "5:15 PM")];
  const plan = planSlot(stops, "Afternoon", 60);
  assert.equal(plan.tight, true, "an hour does not fit between 4pm and 5:15pm with buffers");
  assert.equal(plan.time, "4:00 PM", "so it sits directly after the lunch it follows");
});

test("a long visit still starts inside its window even if it ends outside", () => {
  // The window bounds when a stop *starts*. A coffee at 11:30 is a morning coffee even though you
  // leave at half past twelve — the first version required the whole visit to fit and called an
  // ordinary morning full.
  const plan = planSlot([stop("Market", "9:00 AM", "2 hours")], "Morning", 90);
  assert.equal(plan.tight, false);
  assert.equal(plan.time, "11:15 AM");
});

test("assigned times land on a five-minute grid, so they read like times", () => {
  // The tight clamp used to surface the last minute of a window — "4:59 PM" in an itinerary reads
  // as a bug rather than as a tight fit.
  const stops = [
    stop("A", "12:00 PM", "2 hours"),
    stop("B", "2:15 PM", "2 hours"),
    stop("C", "4:30 PM", "30 min"),
    stop("Dinner", "5:00 PM"),
  ];
  for (const slot of ["Morning", "Afternoon", "Evening"]) {
    const plan = planSlot(stops, slot);
    assert.equal(at(plan) % 5, 0, `${slot} gave ${plan.time}`);
  }
  // A previous stop ending off-grid pushes past the anchor, so the raw answer is 11:02.
  assert.equal(planSlot([stop("Odd", "10:07 AM", "40 min")], "Morning").time, "11:00 AM");
});

test("an empty day gets the window's anchor", () => {
  for (const slot of ["Morning", "Afternoon", "Evening"]) {
    const plan = planSlot([], slot);
    assert.equal(plan.index, 0);
    assert.equal(at(plan), SLOT_WINDOWS[slot].anchor, slot);
    assert.equal(plan.tight, false);
  }
});

test("a stop slotted before everything already planned goes first", () => {
  const stops = [stop("Lunch", "1:00 PM"), stop("Dinner", "8:00 PM")];
  const plan = planSlot(stops, "Morning");
  assert.equal(plan.index, 0);
  assert.equal(plan.time, "10:00 AM");
});

test("a full afternoon is reported tight rather than silently double-booked", () => {
  const stops = [
    stop("A", "12:00 PM", "2 hours"),
    stop("B", "2:15 PM", "2 hours"),
    stop("C", "4:30 PM", "30 min"),
    stop("Dinner", "5:00 PM"),
  ];
  const plan = planSlot(stops, "Afternoon", 60);
  assert.equal(plan.tight, true);
  // Still inside the afternoon, and still after the last afternoon stop in the running order.
  assert.equal(plan.index, 3);
  assert.equal(timeOfDay(at(plan)), "Afternoon");
});

test("whatever time is assigned reads back as the slot the traveler picked", () => {
  // The stop list groups by `timeOfDay`, so a stop filed under Morning appearing beneath an
  // AFTERNOON heading would be the feature contradicting itself on screen. Holds even when the
  // day is too full to honour the choice comfortably.
  const days = [
    [],
    [stop("One", "9:00 AM")],
    [stop("One", "11:45 AM", "3 hours"), stop("Two", "4:45 PM", "3 hours")],
    [stop("Dawn", "6:00 AM"), stop("Late", "11:30 PM")],
    [stop("A", "8:00 AM", "4 hours"), stop("B", "12:00 PM", "5 hours"), stop("C", "5:00 PM", "5 hours")],
  ];
  for (const stops of days) {
    for (const slot of ["Morning", "Afternoon", "Evening"]) {
      const plan = planSlot(stops, slot);
      assert.equal(
        timeOfDay(at(plan)),
        slot,
        `${slot} on ${JSON.stringify(stops.map((s) => s.time))} gave ${plan.time}`
      );
    }
  }
});

test("stops with unreadable times bound nothing but keep their place", () => {
  const stops = [stop("Unknown", "sometime"), stop("Dinner", "7:00 PM")];
  const plan = planSlot(stops, "Afternoon");
  // The unparseable stop is stepped over exactly as the day panel's grouping steps over it, so the
  // afternoon lands before dinner rather than being pushed by a stop with no time at all.
  assert.equal(plan.index, 1);
  assert.equal(plan.time, "2:30 PM");
});

test("a day with no readable times at all appends at the anchor", () => {
  const stops = [stop("One", ""), stop("Two", "whenever")];
  const plan = planSlot(stops, "Evening");
  assert.equal(plan.index, 2);
  assert.equal(plan.time, "7:00 PM");
});

test("a stop with no duration is spaced as if it took the default", () => {
  const stops = [stop("Vague", "9:00 AM", "")];
  const plan = planSlot(stops, "Morning");
  // 9:00 + DEFAULT_VISIT_MIN + the buffer.
  assert.equal(at(plan), 9 * 60 + DEFAULT_VISIT_MIN + 15);
});
