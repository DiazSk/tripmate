import assert from "node:assert/strict";
import test from "node:test";
import { insertTrace, updateTrace } from "./db.ts";
import { dailyCapResumesAt } from "./spendCap.ts";

// The suite's DB is in memory (scripts/test-db.mjs). Each test uses its own `t`, more than a day
// after the last one's, so no test's rows fall inside another's 24h window.
const HOUR = 3_600_000;

function spend(costUsd, at) {
  const id = insertTrace({ type: "generate", prompt: "p", model: "m", createdAt: new Date(at).toISOString() });
  updateTrace(id, { status: "ok", costUsd });
}

test("dailyCapResumesAt is null when DAILY_SPEND_CAP_USD is unset", () => {
  delete process.env.DAILY_SPEND_CAP_USD;
  assert.equal(dailyCapResumesAt(), null);
});

test("dailyCapResumesAt is null when DAILY_SPEND_CAP_USD is not a finite number", () => {
  process.env.DAILY_SPEND_CAP_USD = "not-a-number";
  assert.equal(dailyCapResumesAt(), null);
  delete process.env.DAILY_SPEND_CAP_USD;
});

test("the cap lifts when the oldest spend that keeps it over ages out of the window", () => {
  process.env.DAILY_SPEND_CAP_USD = "10";
  const t = Date.parse("2031-01-01T12:00:00.000Z");
  spend(6, t - 20 * HOUR);
  spend(6, t - 2 * HOUR);
  assert.equal(dailyCapResumesAt(t)?.toISOString(), new Date(t - 20 * HOUR + 24 * HOUR).toISOString());
  delete process.env.DAILY_SPEND_CAP_USD;
});

test("spend under the cap is not capped", () => {
  process.env.DAILY_SPEND_CAP_USD = "10";
  const t = Date.parse("2031-01-05T12:00:00.000Z");
  spend(4, t - 20 * HOUR);
  spend(4, t - 2 * HOUR);
  assert.equal(dailyCapResumesAt(t), null);
  delete process.env.DAILY_SPEND_CAP_USD;
});

test("a cap of 0 is always capped, a day out", () => {
  process.env.DAILY_SPEND_CAP_USD = "0";
  const t = Date.parse("2031-01-10T12:00:00.000Z");
  assert.equal(dailyCapResumesAt(t)?.getTime(), t + 24 * HOUR);
  delete process.env.DAILY_SPEND_CAP_USD;
});
