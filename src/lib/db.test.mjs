import assert from "node:assert/strict";
import test from "node:test";
import {
  appendLlmSessionTurns,
  createLlmSession,
  getLlmSession,
  getSpendSince,
  insertTrace,
  updateTrace,
} from "./db.ts";

test("createLlmSession/getLlmSession round-trip the messages array", () => {
  const id = createLlmSession([{ role: "user", content: "hi" }]);
  assert.deepEqual(getLlmSession(id), [{ role: "user", content: "hi" }]);
});

test("appendLlmSessionTurns adds to the stored history without dropping earlier turns", () => {
  const id = createLlmSession([{ role: "user", content: "first" }]);
  appendLlmSessionTurns(id, [{ role: "assistant", content: "reply" }]);
  assert.deepEqual(getLlmSession(id), [
    { role: "user", content: "first" },
    { role: "assistant", content: "reply" },
  ]);
});

test("getLlmSession returns undefined for an id that was never created", () => {
  assert.equal(getLlmSession("does-not-exist"), undefined);
});

test("getSpendSince sums cost_usd for traces at or after the cutoff", () => {
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const before = getSpendSince(cutoff);
  const id = insertTrace({ type: "generate", prompt: "p", model: "claude-sonnet-4-5" });
  updateTrace(id, { status: "ok", costUsd: 1.5 });
  assert.equal(getSpendSince(cutoff), before + 1.5);
});
