import { test } from "node:test";
import assert from "node:assert/strict";
import { monthlyFromDaily, bestMonthsFromClimate } from "./monthlyClimate.ts";

test("monthlyFromDaily averages highs to 1 dp and counts days with at least 1mm", () => {
  const out = monthlyFromDaily({
    time: ["2025-01-01", "2025-01-02", "2025-01-03", "2025-02-01", "2025-02-02"],
    temperature_2m_max: [10, 11, 12.4, 20, null],
    precipitation_sum: [0, 1, 5, 0.9, 3],
  });
  assert.deepEqual(out, [
    { month: 1, highC: 11.1, rainDays: 2 },
    { month: 2, highC: 20, rainDays: 1 },
  ]);
});

test("bestMonthsFromClimate leaves out a 40C July and keeps six at most, driest first", () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, highC: 22, rainDays: 12 - i }));
  months[6] = { month: 7, highC: 40, rainDays: 0 };
  const best = bestMonthsFromClimate(months);
  assert.ok(!best.includes(7));
  assert.deepEqual(best, [7, 8, 9, 10, 11, 12].filter((m) => m !== 7).concat([6]).sort((a, b) => a - b));
  assert.equal(best.length, 6);
});
