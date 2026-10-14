import assert from "node:assert/strict";
import test from "node:test";

import { dayCost, LENS_ORDER, LENSES, PETRA_BEATS, petraPrefill, petraSampleDate, routeAlongTrail, toMin } from "./petraDay.ts";

// The date must never rot into one the wizard's `min={today}` rejects, and must stay a Wednesday
// (Petra by Night, the slow day's last stop, runs Sunday to Thursday).
test("the sample date is always today or later, and always a Wednesday", () => {
  for (const today of ["2026-01-01", "2026-04-12", "2026-04-16", "2026-10-14", "2027-12-31"]) {
    const d = petraSampleDate(today);
    assert.ok(d >= today, `${d} is before ${today}`);
    assert.equal(new Date(`${d}T00:00:00Z`).getUTCDay(), 3, `${d} is not a Wednesday`);
  }
  assert.equal(petraSampleDate("2026-10-14"), "2027-04-14");
});

test("the prefill makes the sample day the middle of three, with no invented budget", () => {
  const p = petraPrefill("2026-10-14", 2);
  assert.deepEqual(p, { destination: "Petra, Jordan", startDate: "2027-04-13", endDate: "2027-04-15", adults: 2, children: 0 });
  assert.equal("budgetUsd" in p, false);
});

test("every way of the day runs forward in time, without overlaps, and is priced", () => {
  for (const id of LENS_ORDER) {
    const stops = LENSES[id].stops;
    for (let i = 1; i < stops.length; i++) {
      const prevEnd = toMin(stops[i - 1].time) + stops[i - 1].min;
      assert.ok(toMin(stops[i].time) >= prevEnd, `${id}: ${stops[i].id} starts before ${stops[i - 1].id} ends`);
    }
    assert.ok(dayCost(stops) > 0);
  }
});

test("a route starts at the first stop and ends at the last", () => {
  const at = LENSES.slow.stops.map((s) => s.at);
  const r = routeAlongTrail(at);
  assert.deepEqual(r[0], at[0]);
  assert.deepEqual(r.at(-1), at.at(-1));
});

test("every story beat is a stop of the slow day, at that stop's time", () => {
  for (const b of PETRA_BEATS) {
    const stop = LENSES.slow.stops.find((s) => s.id === b.stop);
    assert.ok(stop, `beat ${b.stop} has no stop`);
    assert.equal(b.time, stop.time, `beat ${b.stop} says ${b.time}, the plan says ${stop.time}`);
  }
});
