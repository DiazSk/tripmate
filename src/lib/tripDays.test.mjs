/* Run: node --test src/lib/tripDays.test.mjs
 *
 * Calendar-date arithmetic is the one thing in this codebase that has already shipped a visible
 * wrong answer (a day-of-week off by one, from formatting a UTC-midnight date with local
 * accessors). Adding and removing trip days re-dates every day after the change, so a one-day
 * error here silently moves a traveller's whole itinerary. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  blankDay,
  daysBetweenISO,
  insertDay,
  redateDays,
  removeDay,
  shiftISODate,
  tripEndDate,
} from "./tripDays.ts";
import { applyPatch } from "./itineraryPatch.ts";

const day = (date, name) => ({
  date,
  weather: "",
  stops: [
    {
      name,
      lat: 35,
      lng: 135,
      cost: 10,
      note: "",
      time: "9:00 AM",
      durationLabel: "1 hour",
      category: "entry",
    },
  ],
});

const trip = () => ({
  tier: "midrange",
  days: [day("2026-09-19", "A"), day("2026-09-20", "B"), day("2026-09-21", "C")],
});

test("shiftISODate crosses month and year boundaries in UTC", () => {
  assert.equal(shiftISODate("2026-09-19", 1), "2026-09-20");
  assert.equal(shiftISODate("2026-09-30", 1), "2026-10-01");
  assert.equal(shiftISODate("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftISODate("2026-03-01", -1), "2026-02-28");
  // 2028 is a leap year — the check that a naive +365 would fail.
  assert.equal(shiftISODate("2028-02-28", 1), "2028-02-29");
  assert.equal(shiftISODate("2026-09-19", 0), "2026-09-19");
  assert.equal(shiftISODate("not-a-date", 1), "");
});

test("daysBetweenISO and tripEndDate agree with each other", () => {
  assert.equal(daysBetweenISO("2026-09-19", "2026-09-21"), 2);
  assert.equal(daysBetweenISO("2026-09-21", "2026-09-19"), -2);
  assert.equal(daysBetweenISO("2026-09-19", "2026-09-19"), 0);
  assert.equal(tripEndDate("2026-09-19", 3), "2026-09-21");
  assert.equal(tripEndDate("2026-09-19", 1), "2026-09-19");
  // A zero-day trip has no meaningful end; it must not read as "the day before the start".
  assert.equal(tripEndDate("2026-09-19", 0), "2026-09-19");
});

test("redateDays makes dates contiguous and leaves everything else untouched", () => {
  const out = redateDays([day("2020-01-01", "A"), day("1999-05-05", "B")], "2026-09-19");
  assert.deepEqual(out.map((d) => d.date), ["2026-09-19", "2026-09-20"]);
  assert.equal(out[1].stops[0].name, "B", "content rides along with its day");
});

test("insertDay appends, extends the end date, and keeps the start fixed", () => {
  const out = insertDay(trip(), 3);
  assert.equal(out.days.length, 4);
  assert.deepEqual(out.days.map((d) => d.date), [
    "2026-09-19",
    "2026-09-20",
    "2026-09-21",
    "2026-09-22",
  ]);
  assert.deepEqual(out.days[3].stops, [], "the new day arrives empty");
  assert.equal(out.days[0].date, "2026-09-19", "the start date never moves");
  assert.equal(tripEndDate(out.days[0].date, out.days.length), "2026-09-22");
});

test("insertDay in the middle shifts later content forward a day, not the trip's start", () => {
  const out = insertDay(trip(), 1);
  assert.equal(out.days.length, 4);
  // Day 1 keeps its date and content; B and C each move one day later.
  assert.equal(out.days[0].stops[0].name, "A");
  assert.equal(out.days[0].date, "2026-09-19");
  assert.deepEqual(out.days[1].stops, []);
  assert.equal(out.days[1].date, "2026-09-20");
  assert.equal(out.days[2].stops[0].name, "B");
  assert.equal(out.days[2].date, "2026-09-21");
  assert.equal(out.days[3].stops[0].name, "C");
  assert.equal(out.days[3].date, "2026-09-22");
});

test("insertDay at 0 shifts the itinerary later rather than moving the start date back", () => {
  const out = insertDay(trip(), 0);
  assert.equal(out.days[0].date, "2026-09-19", "still starts the same day");
  assert.deepEqual(out.days[0].stops, [], "the blank day takes the first slot");
  assert.equal(out.days[1].stops[0].name, "A");
});

test("removeDay closes the gap and shortens the trip", () => {
  const out = removeDay(trip(), 1);
  assert.equal(out.days.length, 2);
  assert.deepEqual(out.days.map((d) => d.date), ["2026-09-19", "2026-09-20"]);
  assert.deepEqual(out.days.map((d) => d.stops[0].name), ["A", "C"], "C moves up into day 2");
});

test("removeDay refuses to leave a trip with no days at all", () => {
  const single = { tier: "midrange", days: [day("2026-09-19", "A")] };
  assert.equal(removeDay(single, 0), single);
  // And an index that doesn't exist changes nothing.
  const t = trip();
  assert.deepEqual(removeDay(t, 9).days.length, 3);
});

test("blankDay carries no invented weather", () => {
  const d = blankDay("2026-09-22");
  assert.equal(d.weather, "");
  assert.equal(d.weatherDetail, undefined);
  assert.deepEqual(d.stops, []);
});

// --- through the patch applier -----------------------------------------------------------------

test("add_day / remove_day apply as ops and re-date the trip once", () => {
  const { itinerary, rejected } = applyPatch(trip(), [{ op: "add_day", dayIndex: 3 }]);
  assert.deepEqual(rejected, []);
  assert.equal(itinerary.days.length, 4);
  assert.equal(itinerary.days[3].date, "2026-09-22");

  const dropped = applyPatch(trip(), [{ op: "remove_day", dayIndex: 0 }]);
  assert.deepEqual(dropped.rejected, []);
  assert.equal(dropped.itinerary.days.length, 2);
  // The start date is the trip's, not the removed day's — B now sits on day 1's date.
  assert.equal(dropped.itinerary.days[0].date, "2026-09-19");
  assert.equal(dropped.itinerary.days[0].stops[0].name, "B");
});

test("a day added then filled in the same patch lands its stops on the new day", () => {
  const filled = {
    name: "New stop",
    lat: 35,
    lng: 135,
    cost: 5,
    note: "",
    time: "10:00 AM",
    durationLabel: "1 hour",
    category: "entry",
  };
  const { itinerary, rejected } = applyPatch(trip(), [
    { op: "add_day", dayIndex: 3 },
    { op: "add_stop", dayIndex: 3, stopIndex: 0, stop: filled },
  ]);
  assert.deepEqual(rejected, []);
  assert.equal(itinerary.days.length, 4);
  assert.deepEqual(itinerary.days[3].stops.map((s) => s.name), ["New stop"]);
  assert.equal(itinerary.days[3].date, "2026-09-22");
});

test("a scope-locked element edit cannot add or remove days", () => {
  const scope = { dayIndex: 0, stopIndex: 0 };
  const { itinerary, rejected } = applyPatch(
    trip(),
    [{ op: "add_day", dayIndex: 3 }, { op: "remove_day", dayIndex: 1 }],
    scope
  );
  assert.equal(itinerary.days.length, 3, "the trip's length is untouched");
  assert.equal(rejected.length, 2);
  assert.ok(rejected.every((r) => r.reason.includes("scope")));
});

test("remove_day is refused rather than silently emptying a one-day trip", () => {
  const single = { tier: "midrange", days: [day("2026-09-19", "A")] };
  const { itinerary, rejected } = applyPatch(single, [{ op: "remove_day", dayIndex: 0 }]);
  assert.equal(itinerary.days.length, 1);
  assert.match(rejected[0].reason, /at least one day/);
});
