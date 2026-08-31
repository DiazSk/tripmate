/* Run: node --test src/lib/lodgingPrompt.test.mjs
 *
 * Lodging price/listing search has been cut entirely (see lodging.ts's removal) — no free or
 * affordable real-time hotel pricing API exists. These functions used to branch on whether real
 * listings were fetched; now there never are any, so each keeps only its no-real-data text. These
 * tests pin that text, which previously guarded against the type-first hedge being merged with
 * text that named a specific property and price. */
import assert from "node:assert/strict";
import test from "node:test";
import { budgetInstruction, lodgingInstruction, lodgingPricingBasis } from "./lodgingPrompt.ts";

test("tells the model to choose the TYPE of stay, not a named property", () => {
  const out = lodgingInstruction();
  assert.match(out, /choose the TYPE of stay/);
  assert.match(out, /invents one that may not exist/);
  assert.match(out, /Never invent specific prices/);
});

test("prices lodging to the style/tier rather than a real rate", () => {
  assert.equal(lodgingPricingBasis(), "priced to the style above");
});

test("keeps the unqualified 85-100% budget target", () => {
  const out = budgetInstruction();
  assert.match(out, /MUST come close to the full stated budget/);
  assert.match(out, /85-100%/);
});
