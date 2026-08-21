import assert from "node:assert/strict";
import test from "node:test";

import {
  formatExampleParty,
  formatExampleSpan,
  planExamples,
  resolveExampleDates,
  toPrefill,
} from "./planExamples.ts";

// The invariant that actually matters. The date inputs carry `min={todayISO()}`, so a resolved start
// date behind "today" is a prefill the form will reject — which is the whole reason these cards
// store a season instead of a date.
test("no card can ever resolve to a date the form would reject", () => {
  for (const today of [
    "2026-01-01",
    "2026-08-21",
    "2026-09-12", // Tuscany's own season, to the day
    "2026-12-31",
    "2027-03-20", // Wadi Rum's own season, to the day
    "2030-07-04",
  ]) {
    for (const example of planExamples) {
      const { startDate, endDate } = toPrefill(example, today);
      assert.ok(
        startDate >= today,
        `${example.id} resolved ${startDate}, before ${today}`
      );
      assert.ok(endDate > startDate, `${example.id} ends on or before it starts`);
    }
  }
});

test("a season still ahead this year stays in this year", () => {
  const { startDate } = resolveExampleDates("09-12", 9, "2026-08-21");
  assert.equal(startDate, "2026-09-12");
});

test("a season already past rolls into next year", () => {
  const { startDate } = resolveExampleDates("02-06", 6, "2026-08-21");
  assert.equal(startDate, "2027-02-06");
});

test("today itself counts as still ahead, not past", () => {
  // The boundary case that decides whether a card goes stale a day early.
  const { startDate } = resolveExampleDates("08-21", 4, "2026-08-21");
  assert.equal(startDate, "2026-08-21");
});

test("the end date is start + days - 1, and crosses a month correctly", () => {
  assert.deepEqual(resolveExampleDates("09-28", 5, "2026-01-01"), {
    startDate: "2026-09-28",
    endDate: "2026-10-02",
  });
});

test("a range crossing new year keeps the right years on both ends", () => {
  assert.deepEqual(resolveExampleDates("12-29", 6, "2026-01-01"), {
    startDate: "2026-12-29",
    endDate: "2027-01-03",
  });
});

test("a one-day trip ends the day it starts", () => {
  const { startDate, endDate } = resolveExampleDates("05-04", 1, "2026-01-01");
  assert.equal(startDate, endDate);
});

test("the end date survives a leap day rather than skipping it", () => {
  // 2028 is a leap year: Feb 27 + 4 days must land on Mar 1, not Feb 29 -> Mar 2.
  assert.deepEqual(resolveExampleDates("02-27", 4, "2028-01-01"), {
    startDate: "2028-02-27",
    endDate: "2028-03-01",
  });
});

test("span and party read as English, not as data", () => {
  assert.equal(formatExampleSpan(9), "9 days, 8 nights");
  assert.equal(formatExampleSpan(2), "2 days, 1 night");
  assert.equal(formatExampleSpan(1), "1 days, 0 nights");
  assert.equal(formatExampleParty(1, 0), "1 adult");
  assert.equal(formatExampleParty(2, 0), "2 adults");
  assert.equal(formatExampleParty(2, 1), "2 adults, 1 child");
  assert.equal(formatExampleParty(2, 3), "2 adults, 3 children");
});

test("a zero child count is omitted rather than stated", () => {
  // "2 adults, 0 children" answers a question nobody asked.
  assert.ok(!formatExampleParty(2, 0).includes("0"));
});

test("every card carries a real destination and a plannable length", () => {
  for (const e of planExamples) {
    assert.match(e.startMonthDay, /^\d{2}-\d{2}$/, `${e.id} season is not MM-DD`);
    assert.ok(e.days >= 2, `${e.id} is too short to be a trip`);
    assert.ok(e.adults >= 1, `${e.id} has no adults`);
    assert.ok(e.budgetUsd > 0, `${e.id} has no budget`);
    assert.ok(e.destination.includes(","), `${e.id} destination lacks a country`);
    assert.ok(e.photo.src.startsWith("/scenes/"), `${e.id} photo is not a local asset`);
  }
});
