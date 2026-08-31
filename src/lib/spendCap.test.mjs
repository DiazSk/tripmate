import assert from "node:assert/strict";
import test from "node:test";
import { isOverDailyCap } from "./spendCap.ts";

test("isOverDailyCap is false when DAILY_SPEND_CAP_USD is unset", () => {
  delete process.env.DAILY_SPEND_CAP_USD;
  assert.equal(isOverDailyCap(), false);
});

test("isOverDailyCap is false when DAILY_SPEND_CAP_USD is not a finite number", () => {
  process.env.DAILY_SPEND_CAP_USD = "not-a-number";
  assert.equal(isOverDailyCap(), false);
  delete process.env.DAILY_SPEND_CAP_USD;
});

test("isOverDailyCap trips once today's spend reaches the configured cap", () => {
  // A $0 cap trips regardless of actual spend, since SUM(cost_usd) is never negative —
  // deterministic without depending on what other tests have already written to the DB.
  process.env.DAILY_SPEND_CAP_USD = "0";
  assert.equal(isOverDailyCap(), true);
  delete process.env.DAILY_SPEND_CAP_USD;
});
