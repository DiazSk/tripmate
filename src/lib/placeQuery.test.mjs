/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/placeQuery.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";

import { placeQuery, namesAPlace, searchTermsFor } from "./placeQuery.ts";

// The cases are the iOS suite's, deliberately — `StopResolution.swift` carries the same two rules
// for the same data, and the two must not drift.

test("a meal at a place asks about the place", () => {
  assert.equal(placeQuery("Breakfast at Caffè Poliziano"), "Caffè Poliziano");
  assert.equal(placeQuery("Dinner around Pike Place Market"), "Pike Place Market");
  assert.equal(placeQuery("Lunch in Pienza centro"), "Pienza centro");
  assert.equal(placeQuery("Drinks near the Duomo"), "the Duomo");
});

test("a name that merely contains a separator is left whole", () => {
  // Splitting unconditionally gives "Pienza", which resolves to the town centroid — the exact
  // defect this module exists to repair.
  assert.equal(placeQuery("Museum of Art in Pienza"), "Museum of Art in Pienza");
  assert.equal(placeQuery("Abbey of Sant'Antimo"), "Abbey of Sant'Antimo");
});

test("only the first separator cuts", () => {
  assert.equal(placeQuery("Dinner at the trattoria in Pienza"), "the trattoria in Pienza");
});

test("a meal with no place after it asks nothing", () => {
  for (const junk of ["Lunch", "  Dinner  ", "", "   ", "Breakfast at"]) {
    assert.equal(placeQuery(junk), null, JSON.stringify(junk));
  }
});

test("a meal word with no separator keeps its whole name", () => {
  assert.equal(placeQuery("Breakfast buffet"), "Breakfast buffet");
});

test("the vocabulary ignores case and accents", () => {
  assert.equal(placeQuery("BREAKFAST AT Caffè Poliziano"), "Caffè Poliziano");
  assert.equal(placeQuery("Dinner, at Latte di Luna"), "Latte di Luna");
  // "Café" is not a lead-in, so this is a place name and stays whole.
  assert.equal(placeQuery("Café at Piazza Grande"), "Café at Piazza Grande");
});

test("a proper name is a place and a kind of place is not", () => {
  assert.ok(namesAPlace("Caffè Poliziano"));
  assert.ok(namesAPlace("Corso Rossellino"));
  assert.ok(namesAPlace("Abbey of Sant'Antimo"));
  // The case that made this function exist: these resolve to *a* cheese dairy and *an*
  // agriturismo, which no distance bound can catch because the imposter is a kilometre away.
  assert.equal(namesAPlace("caseificio"), false);
  assert.equal(namesAPlace("agriturismo restaurant"), false);
});

test("an opening capital is not a proper name", () => {
  // A sentence capitalises its first word whether or not it names anything.
  assert.equal(namesAPlace("Pasta-making class"), false);
  assert.equal(namesAPlace("Car rental pickup"), false);
  assert.equal(namesAPlace("Pienza centro"), false);
});

test("the full name is always searched, so exact OSM names keep matching", () => {
  const terms = searchTermsFor(["Abbey of Sant'Antimo"]);
  assert.deepEqual([...terms.keys()], ["Abbey of Sant'Antimo"]);
});

test("a phrase-shaped name also searches for the place inside it", () => {
  const terms = searchTermsFor(["Breakfast at Caffè Poliziano"]);
  assert.deepEqual(
    [...terms.keys()].sort(),
    ["Breakfast at Caffè Poliziano", "Caffè Poliziano"]
  );
  assert.deepEqual(terms.get("Caffè Poliziano"), ["Breakfast at Caffè Poliziano"]);
});

test("a vague place is not searched for separately", () => {
  // Only the full name goes in — "agriturismo restaurant" would match an arbitrary one.
  const terms = searchTermsFor(["Dinner at agriturismo restaurant"]);
  assert.deepEqual([...terms.keys()], ["Dinner at agriturismo restaurant"]);
});

test("two stops wanting the same place share one search term", () => {
  const terms = searchTermsFor([
    "Breakfast at Caffè Poliziano",
    "Coffee at Caffè Poliziano",
  ]);
  assert.deepEqual(terms.get("Caffè Poliziano"), [
    "Breakfast at Caffè Poliziano",
    "Coffee at Caffè Poliziano",
  ]);
});

test("blank names contribute nothing", () => {
  assert.equal(searchTermsFor(["", "   "]).size, 0);
});
