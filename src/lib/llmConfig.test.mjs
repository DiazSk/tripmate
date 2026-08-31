import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  CHAT_FALLBACK_MODEL,
  MODEL_PRICES,
  apiModelFor,
  chatModel,
  cheapModel,
  computeCostUsd,
  llmMode,
  llmModeSource,
  maxTokensFor,
  setLlmMode,
  strongModel,
  supportsAdaptiveThinking,
  supportsEffort,
  refusalFallbackEnabled,
} from "./llmConfig.ts";

/** Every test that touches env or the runtime override has to put both back — the module holds
 *  `runtimeOverride` in module scope, and `node --test` shares one module instance across files. */
const ENV_KEYS = [
  "LLM_MODE",
  "LLM_MODEL_STRONG",
  "LLM_MODEL_CHEAP",
  "LLM_MODEL_CHAT",
  "LLM_REFUSAL_FALLBACK",
];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  setLlmMode(null);
});

describe("transport mode", () => {
  it("defaults to api with nothing configured", () => {
    assert.equal(llmMode(), "api");
    assert.equal(llmModeSource(), "default");
  });

  it("reads LLM_MODE from the environment", () => {
    process.env.LLM_MODE = "cli";
    assert.equal(llmMode(), "cli");
    assert.equal(llmModeSource(), "env");
  });

  it("ignores an unrecognised LLM_MODE rather than failing the app", () => {
    process.env.LLM_MODE = "grpc";
    assert.equal(llmMode(), "api");
    assert.equal(llmModeSource(), "default");
  });

  it("lets the runtime override beat the environment", () => {
    process.env.LLM_MODE = "cli";
    assert.equal(setLlmMode("api"), "api");
    assert.equal(llmModeSource(), "runtime");
  });

  it("hands the decision back to env when the override is cleared", () => {
    process.env.LLM_MODE = "cli";
    setLlmMode("api");
    assert.equal(setLlmMode(null), "cli");
    assert.equal(llmModeSource(), "env");
  });
});

describe("model routing", () => {
  it("puts every whole-plan call on the strong tier", () => {
    for (const type of ["generate", "refine", "rebalance", "critique"]) {
      assert.equal(apiModelFor(type), "claude-opus-5", type);
    }
  });

  it("puts every bounded call on the cheap tier", () => {
    for (const type of ["chat", "element-edit", "place-detail", "context"]) {
      assert.equal(apiModelFor(type), "claude-haiku-4-5", type);
    }
  });

  it("routes every call type to something", () => {
    const types = [
      "generate",
      "refine",
      "rebalance",
      "place-detail",
      "context",
      "critique",
      "chat",
      "element-edit",
      "judge",
    ];
    for (const type of types) assert.ok(apiModelFor(type), `${type} routed nowhere`);
  });

  it("overrides each tier from the environment", () => {
    process.env.LLM_MODEL_STRONG = "claude-fable-5";
    process.env.LLM_MODEL_CHEAP = "claude-sonnet-4-6";
    assert.equal(strongModel(), "claude-fable-5");
    assert.equal(cheapModel(), "claude-sonnet-4-6");
    assert.equal(apiModelFor("generate"), "claude-fable-5");
    assert.equal(apiModelFor("place-detail"), "claude-sonnet-4-6");
  });

  it("follows the cheap tier for chat until chat is given its own model", () => {
    process.env.LLM_MODEL_CHEAP = "claude-sonnet-4-6";
    assert.equal(chatModel(), "claude-sonnet-4-6");
    process.env.LLM_MODEL_CHAT = CHAT_FALLBACK_MODEL;
    assert.equal(chatModel(), "claude-sonnet-5");
    // The documented escape hatch has to move chat alone — raising the whole cheap tier would
    // silently reprice place-detail and context too.
    assert.equal(apiModelFor("chat"), "claude-sonnet-5");
    assert.equal(apiModelFor("place-detail"), "claude-sonnet-4-6");
  });

  it("treats a blank env var as unset rather than as an empty model id", () => {
    process.env.LLM_MODEL_STRONG = "   ";
    assert.equal(strongModel(), "claude-opus-5");
  });

  it("gives every call type a token ceiling, largest for whole itineraries", () => {
    assert.ok(maxTokensFor("generate") > maxTokensFor("chat"));
    assert.ok(maxTokensFor("chat") > maxTokensFor("place-detail"));
    for (const type of ["generate", "refine", "rebalance", "critique", "chat", "element-edit", "place-detail", "context", "judge"]) {
      assert.ok(maxTokensFor(type) > 0, type);
    }
  });
});

describe("model capabilities", () => {
  // The load-bearing case: these are a 400, not a no-op, on the default cheap model. A chat call
  // that forwarded the CLI's `--effort low` blindly would fail every single time.
  it("withholds effort and thinking from Haiku 4.5", () => {
    assert.equal(supportsEffort("claude-haiku-4-5"), false);
    assert.equal(supportsAdaptiveThinking("claude-haiku-4-5"), false);
  });

  it("withholds both from the CLI's pinned Sonnet 4.5", () => {
    assert.equal(supportsEffort("claude-sonnet-4-5"), false);
    assert.equal(supportsAdaptiveThinking("claude-sonnet-4-5"), false);
  });

  it("allows both on the strong tier", () => {
    assert.equal(supportsEffort("claude-opus-5"), true);
    assert.equal(supportsAdaptiveThinking("claude-opus-5"), true);
    assert.equal(supportsEffort("claude-sonnet-5"), true);
    assert.equal(supportsAdaptiveThinking("claude-sonnet-5"), true);
  });

  it("matches a dated snapshot like its base id", () => {
    assert.equal(supportsEffort("claude-opus-5-20260401"), true);
    assert.equal(supportsAdaptiveThinking("claude-haiku-4-5-20251001"), false);
  });

  it("denies both to an unrecognised model — a missing param costs tokens, a rejected one costs the call", () => {
    assert.equal(supportsEffort("gpt-4"), false);
    assert.equal(supportsAdaptiveThinking("some-future-model"), false);
  });

  it("enables the refusal fallback only on models that accept it", () => {
    assert.equal(refusalFallbackEnabled("claude-opus-5"), true);
    assert.equal(refusalFallbackEnabled("claude-haiku-4-5"), false);
    assert.equal(refusalFallbackEnabled("claude-sonnet-5"), false);
  });

  it("respects the LLM_REFUSAL_FALLBACK=0 escape hatch", () => {
    process.env.LLM_REFUSAL_FALLBACK = "0";
    assert.equal(refusalFallbackEnabled("claude-opus-5"), false);
  });
});

describe("cost", () => {
  it("prices input and output at the table rate", () => {
    // 1M input + 1M output on Opus 5 = $5 + $25.
    const cost = computeCostUsd("claude-opus-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    assert.equal(cost, 30);
  });

  it("discounts cache reads to a tenth and surcharges writes by a quarter", () => {
    const read = computeCostUsd("claude-opus-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 1_000_000,
    });
    assert.ok(Math.abs(read - 0.5) < 1e-9, `cache read priced at ${read}`);
    const write = computeCostUsd("claude-opus-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
    });
    assert.ok(Math.abs(write - 6.25) < 1e-9, `cache write priced at ${write}`);
  });

  it("returns null for a model with no price on file rather than guessing zero", () => {
    assert.equal(computeCostUsd("mystery-model", { inputTokens: 1000, outputTokens: 1000 }), null);
  });

  it("prices every model the router can select by default", () => {
    for (const model of ["claude-opus-5", "claude-haiku-4-5", CHAT_FALLBACK_MODEL]) {
      assert.ok(MODEL_PRICES[model], `${model} has no price, so its traces would show no cost`);
    }
  });
});
