/* Run: npm test — which registers scripts/ts-resolve.mjs so this can import claude.ts.
 *
 * Both LLM budgets in claude.ts have been mis-set repeatedly, always the same way: the margin was
 * read off the calls that *survived* the cap. A killed call records the cap, not the time it
 * needed, so a percentile over successes can never exceed the cap however heavy the real tail is.
 * `itineraryTimeoutMs` went 132s (below its own p90) -> 218s (killed two real 4-day generations);
 * CRITIQUE_TIMEOUT_MS went 90s (35% killed) -> 150s (35% killed again).
 *
 * So the invariant worth pinning is not a number of seconds — it is that each budget clears the
 * longest call we have ever watched *finish*, with the shortest trip getting the tightest budget
 * (the per-day term hands short trips the least headroom, which is the shape both bugs had).
 *
 * The OBSERVED_* constants are snapshots from `llm_traces`; this suite opens no DB by design. When
 * the distribution moves, re-derive them and the constants together — see the docblocks, and note
 * that the honest query does NOT filter on status='ok'. */
import assert from "node:assert/strict";
import test from "node:test";

import { CRITIQUE_TIMEOUT_MS, itineraryTimeoutMs } from "./claude.ts";

/** Slowest `type='generate'` call of the current prompt era (10.5k-15k chars) that returned
 *  successfully: a 4-day trip, 2026-11-03. Two August calls on 30k-char prompts ran longer and
 *  describe a prompt that no longer exists. */
const OBSERVED_MAX_OK_GENERATE_MS = 304_547;
/** Slowest `type='critique'` call that ever returned successfully — it cleared the old cap by 201ms. */
const OBSERVED_MAX_OK_CRITIQUE_MS = 149_799;

test("even a one-day trip outlasts the slowest generate on record", () => {
  assert.ok(
    itineraryTimeoutMs(1) > OBSERVED_MAX_OK_GENERATE_MS,
    "1-day budget " + itineraryTimeoutMs(1) + "ms must exceed " + OBSERVED_MAX_OK_GENERATE_MS + "ms",
  );
});

test("the critique budget outlasts the slowest critique on record", () => {
  assert.ok(
    CRITIQUE_TIMEOUT_MS > OBSERVED_MAX_OK_CRITIQUE_MS,
    "critique budget " + CRITIQUE_TIMEOUT_MS + "ms must exceed " + OBSERVED_MAX_OK_CRITIQUE_MS + "ms",
  );
});

test("critique is not given less room than generate's base", () => {
  // Critique reasons over a whole generated itinerary on prompts roughly twice the size. Its
  // budget is flat, generate's grows with the writing a longer trip needs (critique runs after the
  // hand-over on the streaming path, so its length is not what a traveller waits for). What must
  // hold is that it is not treated as the cheaper call: no less than generate's own thinking room.
  assert.ok(CRITIQUE_TIMEOUT_MS >= itineraryTimeoutMs(0));
});

test("the budget never shrinks as a trip gets longer", () => {
  for (let days = 1; days < 40; days += 1) {
    assert.ok(itineraryTimeoutMs(days + 1) >= itineraryTimeoutMs(days));
  }
});

test("a runaway day count is still bounded", () => {
  // Saturation, not a specific day count: where the ceiling starts moves with the base.
  assert.equal(itineraryTimeoutMs(100_000), itineraryTimeoutMs(1_000_000));
});
