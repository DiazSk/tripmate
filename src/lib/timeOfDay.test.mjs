/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/timeOfDay.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";

import { parseClockTime, timeOfDay, groupStopsByTimeOfDay } from "./timeOfDay.ts";

const stop = (name, time) => ({
  name,
  time,
  lat: 0,
  lng: 0,
  cost: 0,
  note: "",
  durationLabel: "1 hour",
  category: "other",
});

test("parseClockTime reads the shapes the model actually sends", () => {
  assert.equal(parseClockTime("1:00 PM"), 13 * 60);
  assert.equal(parseClockTime("13:00"), 13 * 60);
  assert.equal(parseClockTime("9:30 AM"), 9 * 60 + 30);
  assert.equal(parseClockTime("9:30am"), 9 * 60 + 30);
  assert.equal(parseClockTime("  8 PM  "), 20 * 60);
  assert.equal(parseClockTime("8:05 p.m."), 20 * 60 + 5);
  assert.equal(parseClockTime("00:15"), 15);
});

test("noon and midnight are the cases the 12-hour clock gets backwards", () => {
  assert.equal(parseClockTime("12:00 AM"), 0, "12 AM is midnight, not noon");
  assert.equal(parseClockTime("12:00 PM"), 12 * 60, "12 PM is noon, not midnight");
  assert.equal(parseClockTime("12:30 AM"), 30);
});

test("parseClockTime returns null rather than guessing", () => {
  for (const bad of ["", null, undefined, "morning", "later", "25:00", "10:75", "13:00 PM", "-1:00"]) {
    assert.equal(parseClockTime(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("timeOfDay boundaries land on the right side", () => {
  assert.equal(timeOfDay(5 * 60), "Morning");
  assert.equal(timeOfDay(11 * 60 + 59), "Morning");
  assert.equal(timeOfDay(12 * 60), "Afternoon");
  assert.equal(timeOfDay(16 * 60 + 59), "Afternoon");
  assert.equal(timeOfDay(17 * 60), "Evening");
});

test("evening is the bucket that wraps past midnight", () => {
  assert.equal(timeOfDay(21 * 60), "Evening");
  assert.equal(timeOfDay(23 * 60 + 59), "Evening");
  assert.equal(timeOfDay(0), "Evening", "midnight is still that night out");
  assert.equal(timeOfDay(4 * 60 + 59), "Evening");
  assert.equal(timeOfDay(5 * 60), "Morning", "…and 5am is where the next morning starts");
});

test("the Mumbai day groups the way it reads on screen", () => {
  const groups = groupStopsByTimeOfDay([
    stop("Lunch around Colaba", "1:00 PM"),
    stop("Gateway of India", "2:45 PM"),
    stop("Colaba Causeway", "4:15 PM"),
    stop("Dinner in Colaba", "6:30 PM"),
    stop("Colaba bars", "8:30 PM"),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.label, g.stops.length]),
    [
      ["Afternoon", 3],
      ["Evening", 2],
    ]
  );
});

test("indices survive grouping — they are what the map and the tour speak in", () => {
  const groups = groupStopsByTimeOfDay([
    stop("a", "8:00 AM"),
    stop("b", "1:00 PM"),
    stop("c", "7:00 PM"),
    stop("d", "10:00 PM"),
  ]);
  assert.deepEqual(
    groups.flatMap((g) => g.stops.map((s) => s.index)),
    [0, 1, 2, 3],
    "every stop keeps the index it had in the day's own array"
  );
  assert.deepEqual(groups.map((g) => g.label), ["Morning", "Afternoon", "Evening"]);
});

test("order is never re-sorted, even when the plan goes backwards", () => {
  const groups = groupStopsByTimeOfDay([stop("late", "3:00 PM"), stop("early", "9:00 AM")]);
  assert.deepEqual(
    groups.map((g) => [g.label, g.stops.map((s) => s.stop.name)]),
    [
      ["Afternoon", ["late"]],
      ["Morning", ["early"]],
    ]
  );
});

test("a stop with no time joins the group in progress", () => {
  const groups = groupStopsByTimeOfDay([
    stop("a", "1:00 PM"),
    stop("b", ""),
    stop("c", "3:00 PM"),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].stops.map((s) => s.stop.name), ["a", "b", "c"]);
});

test("leading untimed stops borrow the first real label instead of opening a guess", () => {
  const groups = groupStopsByTimeOfDay([stop("a", ""), stop("b", "7:00 PM")]);
  assert.deepEqual(groups.map((g) => [g.label, g.stops.length]), [["Evening", 2]]);
});

test("a day with no readable time is one unlabelled group, not one group per stop", () => {
  const groups = groupStopsByTimeOfDay([stop("a", ""), stop("b", "whenever"), stop("c", "")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, null);
  assert.equal(groups[0].stops.length, 3);
});

test("an empty day produces no groups", () => {
  assert.deepEqual(groupStopsByTimeOfDay([]), []);
});
