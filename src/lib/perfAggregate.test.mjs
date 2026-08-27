/* Run: node --test src/lib/perfAggregate.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { parseCliMetrics, aggregatePerfStats } from "./perfAggregate.ts";

const MODEL = "claude-haiku-4-5-20251001";

function envelope(overrides) {
  return JSON.stringify({
    total_cost_usd: 0.0166,
    ttft_ms: 5474,
    time_to_request_ms: 562,
    duration_api_ms: 7070,
    modelUsage: { [MODEL]: { inputTokens: 640, outputTokens: 600 } },
    ...overrides,
  });
}

test("parseCliMetrics reads tokens/cost/timing out of a real envelope", () => {
  const metrics = parseCliMetrics(envelope({}));
  assert.equal(metrics.inputTokens, 640);
  assert.equal(metrics.outputTokens, 600);
  assert.equal(metrics.costUsd, 0.0166);
  assert.equal(metrics.ttftMs, 5474);
  assert.equal(metrics.timeToRequestMs, 562);
  assert.equal(metrics.apiDurationMs, 7070);
});

test("parseCliMetrics returns all-null on missing or malformed input", () => {
  const missing = parseCliMetrics(null);
  assert.equal(missing.inputTokens, null);
  assert.equal(missing.costUsd, null);

  const malformed = parseCliMetrics("not json");
  assert.equal(malformed.ttftMs, null);

  const partial = parseCliMetrics(JSON.stringify({ total_cost_usd: 0.01 }));
  assert.equal(partial.costUsd, 0.01);
  assert.equal(partial.inputTokens, null);
  assert.equal(partial.ttftMs, null);
});

test("aggregatePerfStats groups by type and computes avg/median/p95", () => {
  const traces = [
    { type: "generate", durationMs: 1000, rawResponse: envelope({ ttft_ms: 100 }) },
    { type: "generate", durationMs: 2000, rawResponse: envelope({ ttft_ms: 200 }) },
    { type: "generate", durationMs: 3000, rawResponse: envelope({ ttft_ms: 300 }) },
    { type: "place-detail", durationMs: 500, rawResponse: envelope({ ttft_ms: 50 }) },
  ];
  const stats = aggregatePerfStats(traces);
  assert.equal(stats.length, 2);

  const generate = stats.find((s) => s.type === "generate");
  assert.equal(generate.count, 3);
  assert.equal(generate.durationMs.avg, 2000);
  assert.equal(generate.durationMs.median, 2000);
  assert.equal(generate.ttftMs.avg, 200);

  const placeDetail = stats.find((s) => s.type === "place-detail");
  assert.equal(placeDetail.count, 1);
  assert.equal(placeDetail.durationMs.avg, 500);
});

test("aggregatePerfStats excludes null values from a metric's own stats rather than treating them as zero", () => {
  const traces = [
    { type: "context", durationMs: 400, rawResponse: null },
    { type: "context", durationMs: 600, rawResponse: envelope({ total_cost_usd: 0.02 }) },
  ];
  const [context] = aggregatePerfStats(traces);
  assert.equal(context.durationMs.avg, 500);
  assert.equal(context.costUsd.avg, 0.02);
  assert.equal(context.costUsd.median, 0.02);
});

test("aggregatePerfStats returns an empty array for no input", () => {
  assert.deepEqual(aggregatePerfStats([]), []);
});

test("parseCliMetrics reads tokens regardless of which model key is present", () => {
  const raw = JSON.stringify({
    total_cost_usd: 0.02,
    modelUsage: { "some-other-model-entirely": { inputTokens: 100, outputTokens: 50 } },
  });
  const metrics = parseCliMetrics(raw);
  assert.equal(metrics.inputTokens, 100);
  assert.equal(metrics.outputTokens, 50);
});

test("parseCliMetrics recognizes a Messages API envelope and returns null for CLI-only fields", () => {
  const apiEnvelope = JSON.stringify({
    usage: {
      input_tokens: 120,
      output_tokens: 80,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 500,
    },
  });
  const metrics = parseCliMetrics(apiEnvelope);
  assert.equal(metrics.inputTokens, 120);
  assert.equal(metrics.outputTokens, 80);
  assert.equal(metrics.costUsd, null);
  assert.equal(metrics.ttftMs, null);
  assert.equal(metrics.timeToRequestMs, null);
  assert.equal(metrics.apiDurationMs, null);
});

test("aggregatePerfStats prefers a trace's own cost_usd column over the envelope for cost stats", () => {
  const traces = [
    {
      type: "generate",
      durationMs: 1000,
      rawResponse: JSON.stringify({ usage: { input_tokens: 10, output_tokens: 10 } }),
      costUsd: 0.5,
    },
  ];
  const [generate] = aggregatePerfStats(traces);
  assert.equal(generate.costUsd.avg, 0.5);
});
