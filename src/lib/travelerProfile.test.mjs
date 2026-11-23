/* Run: node --test src/lib/travelerProfile.test.mjs
 *
 * parseProfile is the trust boundary for this feature. A bad enum stored here
 * propagates silently into every future trip's prompt, so it is refused on the
 * way in — and these asserts are what fail if that guard is loosened. */
import assert from "node:assert/strict";
import test from "node:test";
import { keepHomeCity, parseProfile } from "./travelerProfile.ts";
import { derivePaceSpotsPerDay, travelStyleOf } from "./userAnswers.ts";

const valid = {
  group: "family_with_kids",
  explorerStyle: "relaxed",
  energy: "low",
  crowds: "avoid",
  priorities: ["Food", "Shopping"],
  topPriorities: ["Food"],
  dietary: { tags: ["Vegetarian"], note: "no shellfish" },
  accessibility: { stepFreeRequired: true, limitStairs: true, note: "manual wheelchair" },
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

test("an absent accessibility is an old row, not a bad one", () => {
  // Rows written before the field existed must still parse — rejecting them would wipe a
  // traveler's saved preferences the first time they loaded the page.
  const withoutIt = { ...valid };
  delete withoutIt.accessibility;
  assert.deepEqual(parseProfile(withoutIt).accessibility, {
    stepFreeRequired: false,
    limitStairs: false,
    note: "",
  });
});

test("a malformed accessibility is refused, the same as a bad enum", () => {
  // §9e treats a step-free requirement as outranking pace and priority, so a junk value
  // reaching storage would silently mis-plan every future trip.
  assert.equal(parseProfile({ ...valid, accessibility: "wheelchair" }), null);
  assert.equal(parseProfile({ ...valid, accessibility: { stepFreeRequired: "yes" } }), null);
  assert.equal(parseProfile({ ...valid, accessibility: [] }), null);
});

test("a stated accessibility survives the round trip", () => {
  const stated = { stepFreeRequired: true, limitStairs: true, note: "manual wheelchair" };
  assert.deepEqual(parseProfile({ ...valid, accessibility: stated }).accessibility, stated);
});

/* Splitting `explorerStyle` into pace + discovery is only safe if every profile written before
 * the split keeps working. This is a real row, copied verbatim out of a developer's own
 * tripmate.db: no `pace`, no `discovery`, and it must neither be rejected nor read differently
 * than it did before. */
const STORED_BEFORE_THE_SPLIT = {
  group: "family_with_kids",
  explorerStyle: "packed",
  energy: "high",
  crowds: "love",
  priorities: ["food", "art", "history"],
  topPriorities: ["food", "art"],
  dietary: { tags: ["vegetarian", "nut-free"], note: "no shellfish" },
};

test("a profile written before the split still parses, and reads the same", () => {
  const parsed = parseProfile(STORED_BEFORE_THE_SPLIT);
  assert.notEqual(parsed, null, "a stored row must not be rejected by the new fields");
  assert.equal(parsed.explorerStyle, "packed");
  assert.equal(parsed.pace, undefined, "nothing invented a pace that was never stored");
  assert.deepEqual(travelStyleOf(parsed), { pace: "packed", discovery: "mix" });
});

test("and the plans it produces are unchanged", () => {
  const { group, energy } = STORED_BEFORE_THE_SPLIT;
  // packed, with kids, high energy: 5 - 1 = 4 spots a day, exactly as before the split.
  assert.equal(derivePaceSpotsPerDay(travelStyleOf(STORED_BEFORE_THE_SPLIT).pace, group, energy), 4);
});

test("a profile written after the split carries both shapes", () => {
  const parsed = parseProfile({ ...STORED_BEFORE_THE_SPLIT, pace: "relaxed", discovery: "local" });
  assert.equal(parsed.pace, "relaxed");
  assert.equal(parsed.discovery, "local");
});

/* Junk in the new fields must read as "not answered" rather than rejecting a row that is
 * otherwise fine — the legacy field is still there to answer for it. */
test("a junk pace does not throw the whole profile away", () => {
  const parsed = parseProfile({ ...STORED_BEFORE_THE_SPLIT, pace: "sprint" });
  assert.notEqual(parsed, null);
  assert.equal(parsed.pace, undefined);
  assert.equal(travelStyleOf(parsed).pace, "packed");
});

const base = {
  group: "solo", explorerStyle: "mixed", energy: "moderate", crowds: "mixed", priorities: [], topPriorities: [],
  dietary: { tags: [], note: "" }, accessibility: { stepFreeRequired: false, limitStairs: false, note: "" },
};

test("a valid home city is kept on the profile", () => {
  const p = parseProfile({ ...base, homeCity: { name: "Boston", latitude: 42.36, longitude: -71.06 } });
  assert.deepEqual(p.homeCity, { name: "Boston", latitude: 42.36, longitude: -71.06 });
});

test("a malformed home city is dropped, not allowed to reject the whole profile", () => {
  const p = parseProfile({ ...base, homeCity: { name: "", latitude: "x" } });
  assert.ok(p);
  assert.equal(p.homeCity, undefined);
});

const LISBON = { name: "Lisbon", latitude: 38.72, longitude: -9.14 };
const PORTO = { name: "Porto", latitude: 41.15, longitude: -8.61 };

test("keepHomeCity keeps the stored city when a writer that predates the field omits it", () => {
  assert.deepEqual(keepHomeCity(valid, { ...valid, homeCity: LISBON }), { ...valid, homeCity: LISBON });
});

test("keepHomeCity lets a stated home city win", () => {
  assert.deepEqual(keepHomeCity({ ...valid, homeCity: PORTO }, { ...valid, homeCity: LISBON }).homeCity, PORTO);
});

test("keepHomeCity leaves the profile alone when nothing is stored", () => {
  assert.equal(keepHomeCity(valid, null), valid);
  assert.equal(keepHomeCity(valid, valid), valid);
});
