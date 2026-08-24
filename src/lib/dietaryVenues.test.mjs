/* Run: node --test src/lib/dietaryVenues.test.mjs
 *
 * The load-bearing case is that a traveler with no stated needs triggers nothing at all — no call,
 * no note change, a byte-identical plan. §3d only becomes a hard constraint when something was
 * actually stated, and spending a metered lookup per food stop otherwise is pure waste.
 *
 * The second is that only tags with a real Yelp category are searched. A free-text note like
 * "no raw onion" has nothing to search on, and inventing a category would return confidently
 * irrelevant venues — which is worse than returning none, because the note would then assert the
 * area was checked. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  dietaryNote,
  distilVenues,
  noOptionsFinding,
  searchableCategories,
} from "./dietaryVenues.ts";

test("finds nothing to search when no needs were stated", () => {
  assert.deepEqual(searchableCategories(null), []);
  assert.deepEqual(searchableCategories({ tags: [], note: "" }), []);
});

test("maps stated tags onto Yelp categories", () => {
  assert.deepEqual(searchableCategories({ tags: ["Vegan"], note: "" }), ["vegan"]);
  assert.deepEqual(searchableCategories({ tags: ["Gluten-Free"], note: "" }), ["gluten_free"]);
  assert.deepEqual(searchableCategories({ tags: ["Halal", "Kosher"], note: "" }), ["halal", "kosher"]);
});

test("tolerates spacing and casing drift in a stated tag", () => {
  assert.deepEqual(searchableCategories({ tags: ["gluten free"], note: "" }), ["gluten_free"]);
});

test("ignores a free-text restriction with no category to search", () => {
  // "no raw onion" is a real constraint, but not a searchable one — the §3d note still carries it.
  assert.deepEqual(searchableCategories({ tags: [], note: "no raw onion" }), []);
  assert.deepEqual(searchableCategories({ tags: ["Nut allergy"], note: "" }), []);
});

test("does not search the same category twice", () => {
  assert.deepEqual(searchableCategories({ tags: ["Vegan", "vegan", "VEGAN"], note: "" }), ["vegan"]);
});

test("distils real venues, keeping rating and price band", () => {
  // Shape verified live against a Paris coordinate search.
  const raw = {
    businesses: [
      { name: "Chez Germain", rating: 4.3, price: null },
      { name: "Hank Burger Paris Archives", rating: 4.4, price: "€€" },
      { name: "Riz Riz", rating: 4.5, price: null },
    ],
  };
  const venues = distilVenues(raw);
  assert.equal(venues.length, 2); // capped: the note wants one or two examples, not a directory
  assert.equal(venues[0].name, "Chez Germain");
  assert.equal(venues[1].price, "€€");
});

test("drops an entry with no usable name", () => {
  assert.deepEqual(distilVenues({ businesses: [{ rating: 4.5 }, { name: "  " }] }), []);
});

test("tolerates a malformed payload without throwing", () => {
  assert.deepEqual(distilVenues(null), []);
  assert.deepEqual(distilVenues({}), []);
  assert.deepEqual(distilVenues({ businesses: "nope" }), []);
});

test("builds a note only when there is something real to name", () => {
  assert.equal(dietaryNote(null), "");
  assert.equal(dietaryNote([]), "");
  const note = dietaryNote([{ name: "Chez Germain", rating: 4.3, price: null }, { name: "Riz Riz", rating: 4.5, price: "€€" }]);
  assert.match(note, /Chez Germain/);
  assert.match(note, /Riz Riz \(€€\)/);
});

test("phrases an empty area as a defect to fix, not a note to append", () => {
  // §3d: "a beautiful day with one impossible meal in it is a failed day".
  const finding = noOptionsFinding("Lunch around Le Marais", "2026-09-14");
  assert.match(finding, /no places matching/);
  assert.match(finding, /move the meal/);
});
