/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/placeSearch.test.mjs
 *
 * `detailsFromTags` is the only thing between OpenStreetMap's tag soup and a card the traveller
 * reads, and two of its jobs are the kind that fail quietly: a `website` value becomes an href they
 * click, and a `wheelchair` value sends somebody to a door that may not open. */
import test from "node:test";
import assert from "node:assert/strict";

import { categoryFromTags, detailsFromTags } from "./placeSearch.ts";
import { categoryForPoiClass } from "./tilePlaces.ts";

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

// --- the two indexes have to agree ------------------------------------------------------------

/**
 * A chip means one thing, whichever index answered it.
 *
 * The tiles serve z14 and up; Overpass serves everything below, and the fallback is invisible to
 * the traveler by design. So if `categoryFromTags` and `CLASS_TO_CATEGORY` disagree, pressing
 * Sights in a city centre and then zooming out returns a different *kind* of list with no error
 * anywhere — which is the exact failure this pairs-off table exists to prevent. Each row is
 * [OSM tags, the OpenMapTiles class the same venue arrives as, the chip both must name].
 */
test("Overpass and the tiles put the same venue under the same chip", () => {
  const pairs = [
    [{ amenity: "cafe" }, "cafe", "cafe"],
    [{ amenity: "ice_cream" }, "ice_cream", "cafe"],
    [{ amenity: "restaurant" }, "restaurant", "restaurant"],
    [{ amenity: "fast_food" }, "fast_food", "restaurant"],
    [{ amenity: "bar" }, "bar", "bar"],
    [{ amenity: "pub" }, "beer", "bar"],
    [{ tourism: "museum" }, "museum", "sights"],
    [{ tourism: "gallery" }, "art_gallery", "sights"],
    [{ tourism: "attraction" }, "attraction", "sights"],
    [{ tourism: "viewpoint" }, "attraction", "sights"],
    [{ amenity: "place_of_worship" }, "place_of_worship", "sights"],
    [{ historic: "castle" }, "castle", "sights"],
    [{ historic: "monument" }, "monument", "sights"],
    [{ amenity: "theatre" }, "theatre", "sights"],
    [{ amenity: "cinema" }, "cinema", "sights"],
    [{ tourism: "hotel" }, "lodging", "hotel"],
    [{ tourism: "hostel" }, "lodging", "hotel"],
    [{ tourism: "guest_house" }, "lodging", "hotel"],
    [{ leisure: "park" }, "park", "park"],
    [{ leisure: "garden" }, "garden", "park"],
    [{ shop: "bakery" }, "bakery", "shop"],
  ];

  const failures = [];
  for (const [tags, klass, expected] of pairs) {
    const fromOverpass = categoryFromTags(tags);
    const fromTiles = categoryForPoiClass(klass);
    if (fromOverpass !== expected) failures.push(`${JSON.stringify(tags)} → ${fromOverpass}, want ${expected}`);
    if (fromTiles !== expected) failures.push(`class ${klass} → ${fromTiles}, want ${expected}`);
  }
  assert.deepEqual(failures, [], `a chip means two things across z14:\n  ${failures.join("\n  ")}`);
});

/**
 * A castle with a gift shop is a castle.
 *
 * `["shop"]` is the broadest selector in `OSM_FILTERS` — any shop tag at all — so it matches a
 * surprising number of places that are primarily something else. Order in `categoryFromTags` is
 * what resolves that, and order is the kind of thing a later edit reshuffles without noticing.
 *
 * Only the clear-cut pairs are asserted. A venue tagged `tourism=hotel` **and** `amenity=restaurant`
 * is genuinely both, and both chips' selectors return it — the category decides only its pin colour
 * and label, so pinning that case down here would be inventing a rule rather than recording one.
 * It currently reads as `restaurant`, which is the more common reason to be looking for it.
 */
test("a sight that also sells things is still a sight", () => {
  assert.equal(categoryFromTags({ historic: "castle", shop: "gift" }), "sights");
  assert.equal(categoryFromTags({ tourism: "museum", shop: "books" }), "sights");
  assert.equal(categoryFromTags({ tourism: "hostel", shop: "convenience" }), "hotel");
});

test("anything unrecognised still falls back rather than inventing a chip", () => {
  assert.equal(categoryFromTags({ office: "lawyer" }), "place");
  assert.equal(categoryFromTags({}), "place");
  assert.equal(categoryFromTags({ amenity: "bench" }, "cafe"), "cafe");
});
