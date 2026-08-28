import assert from "node:assert/strict";
import test from "node:test";
import { parseUsage } from "./runs.ts";

test("parseUsage reads a CLI envelope (modelUsage present)", () => {
  const raw = JSON.stringify({
    modelUsage: { "claude-sonnet-4-5": { inputTokens: 100, outputTokens: 50, costUSD: 0.02 } },
  });
  const usage = parseUsage(raw, "claude-sonnet-4-5");
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.outputTokens, 50);
  assert.equal(usage.costUsd, 0.02);
});

test("parseUsage reads a Messages API envelope (usage present, no modelUsage)", () => {
  const raw = JSON.stringify({
    usage: { input_tokens: 200, output_tokens: 75, cache_read_input_tokens: 10, cache_creation_input_tokens: 20 },
  });
  const usage = parseUsage(raw, "claude-sonnet-4-5");
  assert.equal(usage.inputTokens, 200);
  assert.equal(usage.outputTokens, 75);
  assert.equal(usage.costUsd, null);
});

test("parseUsage prefers the stored cost_usd column when given one", () => {
  const raw = JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } });
  const usage = parseUsage(raw, "claude-sonnet-4-5", 0.9);
  assert.equal(usage.costUsd, 0.9);
});

test("parseUsage returns all-null on missing rawResponse", () => {
  const usage = parseUsage(null);
  assert.equal(usage.inputTokens, null);
  assert.equal(usage.costUsd, null);
  assert.equal(usage.transport, "unknown");
});

test("parseUsage tags a CLI envelope as transport 'cli'", () => {
  const raw = JSON.stringify({
    modelUsage: { "claude-sonnet-4-5": { inputTokens: 100, outputTokens: 50 } },
  });
  assert.equal(parseUsage(raw, "claude-sonnet-4-5").transport, "cli");
});

test("parseUsage tags a Messages API envelope as transport 'api'", () => {
  const raw = JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } });
  assert.equal(parseUsage(raw, "claude-sonnet-4-5").transport, "api");
});

test("parseUsage tags a malformed envelope as transport 'unknown'", () => {
  assert.equal(parseUsage("not json").transport, "unknown");
});
