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
  assert.equal(
    out,
    "Relaxed pace · Iconic and local · Low energy · Avoids crowds · Food, Culture & History"
  );
});

test("each enum renders its own short label, not the picker's long one", () => {
  assert.match(summarizeDurable({ ...base, energy: "high" }), /High energy/);
  assert.match(summarizeDurable({ ...base, crowds: "love" }), /Likes crowds/);
  assert.match(summarizeDurable({ ...base, pace: "packed" }), /Packed pace/);
});

/* Pace and discovery are two answers, and this line is where a traveler checks that the app
 * heard both. One segment could only ever report one of them. */
test("pace and discovery each get their own segment", () => {
  const out = summarizeDurable({ ...base, pace: "packed", discovery: "local" });
  assert.match(out, /Packed pace · Mostly local/);
});

/* Every stored profile predates the pair, so the legacy field has to keep answering — and
 * `offbeat` has to stop being read as a pace, which is the whole point of the split. */
test("a stored profile with only the legacy field still reads", () => {
  assert.match(summarizeDurable({ ...base, explorerStyle: "offbeat" }), /Balanced pace · Mostly local/);
  assert.match(summarizeDurable({ ...base, explorerStyle: "packed" }), /Packed pace · Iconic and local/);
});

/* The pair wins where both are present: a row written by a new client carries a derived
 * `explorerStyle` too, and reading that one back would undo the answer it was derived from. */
test("the explicit pair outranks the legacy field it was derived from", () => {
  const out = summarizeDurable({ ...base, explorerStyle: "offbeat", pace: "packed" });
  assert.match(out, /Packed pace · Mostly local/);
});

test("says so plainly when nothing is starred, rather than trailing an empty segment", () => {
  const out = summarizeDurable({ ...base, topPriorities: [] });
  assert.match(out, /No starred interests/);
  assert.doesNotMatch(out, /· *$/);
});
