import { test } from "node:test";
import assert from "node:assert/strict";
import { categorySelectors } from "./placeQueryTags.ts";

test("category words map to tags, plurals and accents included", () => {
  assert.deepEqual(categorySelectors("coffee"), ['["amenity"="cafe"]']);
  assert.deepEqual(categorySelectors("Cafés"), ['["amenity"="cafe"]']);
  assert.deepEqual(categorySelectors("pharmacies"), ['["amenity"="pharmacy"]']);
  assert.deepEqual(categorySelectors("beaches"), ['["natural"="beach"]']);
  assert.deepEqual(categorySelectors("viewpoint"), ['["tourism"="viewpoint"]']);
  assert.deepEqual(categorySelectors("ATM near me"), ['["amenity"="atm"]']);
});

test("diet and cuisine words narrow a base, or stand alone", () => {
  assert.deepEqual(categorySelectors("halal food"), [
    '["amenity"~"^(restaurant|fast_food)$"]["diet:halal"~"^(yes|only)$"]',
  ]);
  assert.deepEqual(categorySelectors("vegan"), ['["diet:vegan"~"^(yes|only)$"]']);
  assert.deepEqual(categorySelectors("sushi"), ['["cuisine"~"(^|;)sushi($|;)",i]']);
});

test("any unknown word, or an empty query, yields nothing", () => {
  assert.deepEqual(categorySelectors("coffee roasters"), []);
  assert.deepEqual(categorySelectors("Eiffel Tower"), []);
  assert.deepEqual(categorySelectors("constructor"), []);
  assert.deepEqual(categorySelectors("  "), []);
  assert.deepEqual(categorySelectors(undefined), []);
});
