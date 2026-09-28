import assert from "node:assert/strict";
import path from "node:path";
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

/* The one property that cannot be checked from inside a single test: that this file, and the
 * three others that open a database, are not writing into the developer's own.
 *
 * They were. `db.ts` resolves `DB_PATH ?? cwd/tripmate.db` and opens it at import time, so a plain
 * `npm test` inserted four real trips per run — fixture destinations ("Kyoto", "Legacy town")
 * accumulating on the memories wall beside real ones, with nothing failing and nobody told.
 * `scripts/test-db.mjs` fixes it by setting `DB_PATH` to `:memory:` before any of this loads.
 *
 * This assert is what notices if that `--import` is ever dropped from the `test` script, or if a
 * future runner stops passing `execArgv` down to the per-file child processes. It deliberately
 * re-derives the path the same way `db.ts` does rather than asserting `DB_PATH === ":memory:"`,
 * so pointing a one-off run at a scratch file for an investigation still passes. */
test("the suite never opens the developer's own database", () => {
  const ownDatabase = path.join(process.cwd(), "tripmate.db");
  assert.notEqual(
    process.env.DB_PATH ?? ownDatabase,
    ownDatabase,
    "tests are writing to the real tripmate.db — is scripts/test-db.mjs still --imported by the test script?"
  );
});
