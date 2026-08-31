import assert from "node:assert/strict";
import test from "node:test";
import { API_MAX_TOKENS, thinkingFor } from "./claude.ts";

/**
 * The SDK refuses a NON-STREAMING request whose max_tokens implies more than 10 minutes of work.
 * From client.js's calculateNonstreamingTimeout: it throws when
 *   (60min * max_tokens) / 128000 > 10min
 * which solves to max_tokens > 21,333. The guard fires whenever no explicit `timeout` is passed,
 * and runClaudeViaApi passes only an AbortSignal — so this ceiling is live for us, and exceeding
 * it is an immediate AnthropicError at call time, not a slow request.
 */
const SDK_NONSTREAMING_CEILING = (10 * 60 * 128_000) / (60 * 60);

/** Largest output ever observed from the production model (`claude-sonnet-4-5`) in llm_traces.
 *  Re-derive rather than nudge — the honest query counts every status, not just 'ok':
 *    SELECT raw_response FROM llm_traces WHERE type='generate' AND status='ok';
 *  then sum usage.output_tokens (API rows) / modelUsage[model].outputTokens (CLI rows). */
const OBSERVED_MAX_SONNET_OUTPUT_TOKENS = 17_789;

test("API_MAX_TOKENS stays under the SDK's non-streaming ceiling", () => {
  assert.ok(
    API_MAX_TOKENS < SDK_NONSTREAMING_CEILING,
    `API_MAX_TOKENS ${API_MAX_TOKENS} must stay under ${SDK_NONSTREAMING_CEILING}; above it the ` +
      `SDK throws "Streaming is required for operations that may take longer than 10 minutes" ` +
      `on every API-transport call. Raising it further requires switching to streaming.`,
  );
});

test("API_MAX_TOKENS clears the largest generation the production model has ever emitted", () => {
  assert.ok(
    API_MAX_TOKENS > OBSERVED_MAX_SONNET_OUTPUT_TOKENS,
    `API_MAX_TOKENS ${API_MAX_TOKENS} must exceed the observed max ` +
      `${OBSERVED_MAX_SONNET_OUTPUT_TOKENS}, or that generation truncates mid-JSON.`,
  );
});

test("API_MAX_TOKENS leaves room for the thinking budget it has to contain", () => {
  // Thinking tokens are drawn from the same max_tokens budget, and the API rejects a request
  // whose max_tokens does not exceed thinking.budget_tokens.
  const { budget_tokens: budget } = thinkingFor("generate");
  assert.ok(API_MAX_TOKENS > budget);
});

test("thinkingFor omits thinking whenever the caller passed an explicit effort", () => {
  assert.equal(thinkingFor("chat", "low"), undefined);
  assert.equal(thinkingFor("element-edit", "low"), undefined);
  assert.equal(thinkingFor("generate", "low"), undefined);
});

test("thinkingFor gives the big structured-output calls a fixed thinking budget", () => {
  for (const type of ["generate", "refine", "rebalance", "critique"]) {
    assert.deepEqual(thinkingFor(type), { type: "enabled", budget_tokens: 4096 });
  }
});

test("thinkingFor omits thinking for small lookups with no effort passed", () => {
  for (const type of ["place-detail", "context", "judge"]) {
    assert.equal(thinkingFor(type), undefined);
  }
});
