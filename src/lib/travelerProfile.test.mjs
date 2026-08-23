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
  priorities: ["Food", "Shopping"],
  topPriorities: ["Food"],
  dietary: { tags: ["Vegetarian"], note: "no shellfish" },
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
});

test("rejects priorities that are not arrays of strings", () => {
  assert.equal(parseProfile({ ...valid, priorities: "Food" }), null);
  assert.equal(parseProfile({ ...valid, priorities: [1, 2] }), null);
  assert.equal(parseProfile({ ...valid, topPriorities: null }), null);
});

test("a stored profile that still carries a tier loads, rather than being refused", () => {
  // `tier` used to be a validated field here, and an unknown value rejected the WHOLE profile.
  // It was removed with the picker that set it — tier is now derived from each trip's budget. Rows
  // written before that still have the key, and they must parse: refusing them would silently wipe
  // a returning traveler's saved preferences the first time they loaded the page, which is exactly
  // the failure `parseDietary` already guards against for its own field.
  const parsed = parseProfile({ ...valid, tier: "budget" });
  assert.ok(parsed, "an old row carrying a tier must still parse");
  assert.equal("tier" in parsed, false, "and the key must not be carried forward");
});

test("drops unknown fields rather than storing them", () => {
  const parsed = parseProfile({ ...valid, homeCity: "Boston", ssn: "oops" });
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(valid).sort());
});

test("a profile saved before dietary existed still parses, defaulting to empty", () => {
  const { dietary, ...withoutDietary } = valid;
  void dietary;
  const parsed = parseProfile(withoutDietary);
  assert.ok(parsed, "a pre-dietary profile must still parse, not be rejected");
  assert.deepEqual(parsed.dietary, { tags: [], note: "" });
});

test("dietary round-trips both tags and note", () => {
  const parsed = parseProfile(valid);
  assert.deepEqual(parsed.dietary, { tags: ["Vegetarian"], note: "no shellfish" });
});

test("a dietary with a missing note defaults the note, not the whole profile", () => {
  const parsed = parseProfile({ ...valid, dietary: { tags: ["Vegan"] } });
  assert.deepEqual(parsed.dietary, { tags: ["Vegan"], note: "" });
});

test("rejects a malformed dietary rather than silently dropping it", () => {
  assert.equal(parseProfile({ ...valid, dietary: { tags: "Vegetarian", note: "" } }), null);
  assert.equal(parseProfile({ ...valid, dietary: { tags: [1, 2], note: "" } }), null);
  assert.equal(parseProfile({ ...valid, dietary: [] }), null);
  assert.equal(parseProfile({ ...valid, dietary: { tags: [], note: 42 } }), null);
});

test('a saved profile with the "other" group parses', () => {
  // Rejecting it would silently wipe the traveler's whole saved profile back to defaults the
  // first time they loaded the page after picking the new pill.
  assert.deepEqual(parseProfile({ ...valid, group: "other" }), { ...valid, group: "other" });
});
