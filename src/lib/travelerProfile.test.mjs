/* Run: node --test src/lib/travelerProfile.test.mjs
 *
 * parseProfile is the trust boundary for this feature. A bad enum stored here
 * propagates silently into every future trip's prompt, so it is refused on the
 * way in — and these asserts are what fail if that guard is loosened. */
import assert from "node:assert/strict";
import test from "node:test";
import { parseProfile } from "./travelerProfile.ts";

const valid = {
  group: "family_with_kids",
  explorerStyle: "relaxed",
  energy: "low",
  crowds: "avoid",
  tier: "budget",
  priorities: ["Food", "Shopping"],
  topPriorities: ["Food"],
};

test("accepts a fully valid profile", () => {
  assert.deepEqual(parseProfile(valid), valid);
});

test("rejects a non-object", () => {
  for (const bad of [null, undefined, "profile", 42, []]) {
    assert.equal(parseProfile(bad), null);
  }
});

test("rejects an unknown value in any enum field", () => {
  assert.equal(parseProfile({ ...valid, group: "aliens" }), null);
  assert.equal(parseProfile({ ...valid, explorerStyle: "frantic" }), null);
  assert.equal(parseProfile({ ...valid, energy: "boundless" }), null);
  assert.equal(parseProfile({ ...valid, crowds: "tolerate" }), null);
  assert.equal(parseProfile({ ...valid, tier: "platinum" }), null);
});

test("rejects priorities that are not arrays of strings", () => {
  assert.equal(parseProfile({ ...valid, priorities: "Food" }), null);
  assert.equal(parseProfile({ ...valid, priorities: [1, 2] }), null);
  assert.equal(parseProfile({ ...valid, topPriorities: null }), null);
});

test("drops unknown fields rather than storing them", () => {
  const parsed = parseProfile({ ...valid, homeCity: "Boston", ssn: "oops" });
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(valid).sort());
});
