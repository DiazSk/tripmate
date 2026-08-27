import assert from "node:assert/strict";
import test from "node:test";
import { thinkingFor } from "./claude.ts";

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
