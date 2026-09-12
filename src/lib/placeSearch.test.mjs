/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/placeSearch.test.mjs
 *
 * `detailsFromTags` is the only thing between OpenStreetMap's tag soup and a card the traveller
 * reads, and two of its jobs are the kind that fail quietly: a `website` value becomes an href they
 * click, and a `wheelchair` value sends somebody to a door that may not open. */
import test from "node:test";
import assert from "node:assert/strict";

import { detailsFromTags } from "./placeSearch.ts";

test("a place with no interesting tags yields no keys, not empty ones", () => {
  const d = detailsFromTags({ name: "Bar Centrale", amenity: "cafe" });
  // Absent rather than "" — this is what lets the card render a heading only when there is a value.
  for (const k of ["website", "phone", "openingHours", "cuisine", "wheelchair", "outdoorSeating"]) {
    assert.equal(d[k], undefined, `${k} should be absent`);
  }
});

test("the contact: spellings are read too — worth 1 and 6 points of real coverage", () => {
  assert.equal(
    detailsFromTags({ "contact:website": "https://example.org/" }).website,
    "https://example.org/"
  );
  assert.equal(detailsFromTags({ "contact:phone": "+39 0577 1234" }).phone, "+39 0577 1234");
  // The plain spelling wins when both are present.
  assert.equal(detailsFromTags({ website: "https://a.test/", "contact:website": "https://b.test/" }).website, "https://a.test/");
});

test("a website becomes an href, so anything that is not http(s) is dropped", () => {
  // A bare domain is the one repair worth making: common, unambiguous, and the tag's usual shape.
  assert.equal(detailsFromTags({ website: "caffelelogge.it" }).website, "https://caffelelogge.it/");
  // Everything else is refused rather than guessed at.
  assert.equal(detailsFromTags({ website: "javascript:alert(1)" }).website, undefined);
  assert.equal(detailsFromTags({ website: "data:text/html,<script>" }).website, undefined);
  assert.equal(detailsFromTags({ website: "info@example.org" }).website, undefined);
  assert.equal(detailsFromTags({ website: "   " }).website, undefined);
});

test("wheelchair keeps only the three documented values", () => {
  assert.equal(detailsFromTags({ wheelchair: "yes" }).wheelchair, "yes");
  assert.equal(detailsFromTags({ wheelchair: "designated" }).wheelchair, "yes");
  assert.equal(detailsFromTags({ wheelchair: "limited" }).wheelchair, "limited");
  assert.equal(detailsFromTags({ wheelchair: "no" }).wheelchair, "no");
  // "partial" and "limited?" both occur in the wild. Unknown beats a confident wrong "yes".
  assert.equal(detailsFromTags({ wheelchair: "partial" }).wheelchair, undefined);
  assert.equal(detailsFromTags({ wheelchair: "limited?" }).wheelchair, undefined);
});

test("outdoor seating is a tri-state: yes, no, and nobody said", () => {
  assert.equal(detailsFromTags({ outdoor_seating: "yes" }).outdoorSeating, true);
  assert.equal(detailsFromTags({ outdoor_seating: "no" }).outdoorSeating, false);
  assert.equal(detailsFromTags({}).outdoorSeating, undefined);
});

test("a wikidata id is shape-checked before it can reach an API URL", () => {
  assert.equal(detailsFromTags({ wikidata: "Q869130" }).wikidataId, "Q869130");
  assert.equal(detailsFromTags({ wikidata: " Q869130 " }).wikidataId, "Q869130");
  assert.equal(detailsFromTags({ wikidata: "Q869130;Q123" }).wikidataId, undefined);
  assert.equal(detailsFromTags({ wikidata: "see the article" }).wikidataId, undefined);
  assert.equal(detailsFromTags({ wikidata: "Q0" }).wikidataId, undefined);
});
