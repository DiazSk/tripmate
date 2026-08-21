/* Run: npm test */
import assert from "node:assert/strict";
import test from "node:test";
import { BENCH_FIXTURES } from "./fixtures.ts";
import { benchTripSummary, benchUserAnswers, findRefineTask, refineTasksFor } from "./refineTasks.ts";

test("every built-in fixture has refine tasks", () => {
  for (const f of BENCH_FIXTURES) {
    assert.ok(refineTasksFor(f.id).length > 0, `${f.id} has no refine tasks`);
  }
});

test("every task's day index exists in its fixture's trip", () => {
  for (const f of BENCH_FIXTURES) {
    const dayCount = f.reconciled.rawFetch.dateContext.days.length;
    for (const t of refineTasksFor(f.id)) {
      if (t.dayIndex === undefined) continue;
      assert.ok(t.dayIndex < dayCount, `${f.id}/${t.id}: dayIndex ${t.dayIndex} >= ${dayCount} days`);
    }
  }
});

test("every fixture has exactly one restraint task, and it expects no ops", () => {
  for (const f of BENCH_FIXTURES) {
    const restraint = refineTasksFor(f.id).filter((t) => !t.expect.opsExpected);
    assert.equal(restraint.length, 1, `${f.id} should have one ask-don't-tell task`);
  }
});

test("task ids are unique within a fixture", () => {
  for (const f of BENCH_FIXTURES) {
    const ids = refineTasksFor(f.id).map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, `${f.id} has duplicate task ids`);
  }
});

test("a TripSummary derives from the fixture with no invented fields", () => {
  const f = BENCH_FIXTURES[0];
  const trip = benchTripSummary(f);
  const days = f.reconciled.rawFetch.dateContext.days;
  assert.equal(trip.startDate, days[0].date);
  assert.equal(trip.endDate, days[days.length - 1].date);
  assert.equal(trip.budget, f.reconciled.userAnswers.budget);
  assert.ok(trip.destination.length > 0);
  assert.ok(trip.id.startsWith("bench-"));
});

test("userAnswers passes through, so the edit context sees the real profile", () => {
  const f = BENCH_FIXTURES[0];
  assert.equal(benchUserAnswers(f), f.reconciled.userAnswers);
});

test("findRefineTask returns undefined for an unknown id rather than throwing", () => {
  assert.equal(findRefineTask(BENCH_FIXTURES[0].id, "nope"), undefined);
});

test("every fixture with refine tasks has a frozen base itinerary with days", () => {
  for (const f of BENCH_FIXTURES) {
    if (refineTasksFor(f.id).length === 0) continue;
    assert.ok(f.baseItinerary, `${f.id} has tasks but no baseItinerary`);
    assert.ok(f.baseItinerary.days.length > 0, `${f.id}'s baseItinerary has no days`);
    assert.ok(
      f.baseItinerary.days.some((d) => d.stops.length > 0),
      `${f.id}'s baseItinerary has no stops — a patch against it would measure nothing`
    );
  }
});

test("every task's dayIndex exists in its fixture's base itinerary", () => {
  for (const f of BENCH_FIXTURES) {
    for (const t of refineTasksFor(f.id)) {
      if (t.dayIndex === undefined) continue;
      assert.ok(t.dayIndex < f.baseItinerary.days.length, `${f.id}/${t.id}: dayIndex out of range`);
    }
  }
});

test("every base itinerary's stops carry real numeric coordinates, not 0,0", () => {
  // 0,0 is open ocean off West Africa — the exact shape of garbage a model can emit and a
  // naive numeric check would miss (0 is a valid number, just never a valid trip stop here).
  for (const f of BENCH_FIXTURES) {
    if (!f.baseItinerary) continue;
    for (const day of f.baseItinerary.days) {
      for (const stop of day.stops) {
        assert.ok(
          Number.isFinite(stop.lat) && Number.isFinite(stop.lng),
          `${f.id}/"${stop.name}" has a non-numeric coordinate (lat=${stop.lat}, lng=${stop.lng})`
        );
        assert.ok(
          stop.lat !== 0 || stop.lng !== 0,
          `${f.id}/"${stop.name}" is pinned at 0,0 — a patch against it would measure nothing real`
        );
      }
    }
  }
});
