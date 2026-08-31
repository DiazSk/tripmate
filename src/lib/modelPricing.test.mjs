import assert from "node:assert/strict";
import test from "node:test";
import { computeCostUsd, promptTokens, DEFAULT_PRICES } from "./modelPricing.ts";

test("computeCostUsd prices a known model from input/output tokens", () => {
  const cost = computeCostUsd("claude-sonnet-4-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(cost, 3 + 15);
});

test("computeCostUsd applies the cache write/read multipliers", () => {
  const [inRate] = DEFAULT_PRICES["claude-sonnet-4-5"];
  const cost = computeCostUsd("claude-sonnet-4-5", {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 1_000_000,
    cacheReadInputTokens: 1_000_000,
  });
  assert.equal(cost, inRate * 1.25 + inRate * 0.1);
});

test("computeCostUsd returns null for an unpriced model, not 0", () => {
  assert.equal(computeCostUsd("some-unknown-model", { inputTokens: 100, outputTokens: 100 }), null);
});

test("computeCostUsd returns null when output tokens are missing", () => {
  assert.equal(computeCostUsd("claude-sonnet-4-5", { inputTokens: 100, outputTokens: null }), null);
});

test("computeCostUsd accepts a custom price table, e.g. a bench override", () => {
  const cost = computeCostUsd(
    "custom-model",
    { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    { "custom-model": [1, 1] }
  );
  assert.equal(cost, 2);
});

test("promptTokens sums input + cache read + cache creation", () => {
  assert.equal(
    promptTokens({ inputTokens: 10, cacheReadInputTokens: 20, cacheCreationInputTokens: 30, outputTokens: 0 }),
    60
  );
});

test("promptTokens returns null when every field is missing", () => {
  assert.equal(promptTokens({ inputTokens: null, outputTokens: null }), null);
});
