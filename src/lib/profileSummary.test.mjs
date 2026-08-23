/* Run: node --test src/lib/profileSummary.test.mjs
 *
 * This line is the only thing telling a traveler which remembered preferences are being
 * applied to the trip they're about to generate. If it drifts from the real values, the
 * expander stops being an explanation and becomes a second source of truth. */
import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDurable } from "./profileSummary.ts";

const base = {
  explorerStyle: "relaxed",
  energy: "low",
  crowds: "avoid",
  topPriorities: ["Food", "Culture & History"],
};

test("names every value in effect, separated by middots", () => {
  const out = summarizeDurable(base);
  assert.equal(out, "Relaxed pace · Low energy · Avoids crowds · Food, Culture & History");
});

test("each enum renders its own short label, not the picker's long one", () => {
  assert.match(summarizeDurable({ ...base, energy: "high" }), /High energy/);
  assert.match(summarizeDurable({ ...base, crowds: "love" }), /Likes crowds/);
  assert.match(summarizeDurable({ ...base, explorerStyle: "packed" }), /Packed pace/);
});

test("says so plainly when nothing is starred, rather than trailing an empty segment", () => {
  const out = summarizeDurable({ ...base, topPriorities: [] });
  assert.match(out, /No starred interests/);
  assert.doesNotMatch(out, /· *$/);
});
