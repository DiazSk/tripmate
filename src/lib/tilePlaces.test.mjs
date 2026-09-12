import assert from "node:assert/strict";
import test from "node:test";

import { categoryForPoiClass, isTilePlace, placesFromTiles } from "./tilePlaces.ts";

/**
 * The tile reader's failure mode is a plausible-looking wrong list, not an exception — the same
 * reason `cardAnchor.test.mjs` exists. Every case here is one that would ship silently: a chip
 * quietly missing a third of its venues, the same café listed twice because it straddles a tile
 * edge, a search ordered by nothing in particular.
 *
 * The class names are real. They come from a dump of every distinct `class`/`subclass` pair in the
 * z14 tiles for Siena, Rome, Paris, Tokyo and New York.
 */

/** Siena's centre, which is what the fixtures below are laid out around. */
const CENTRE = { lat: 43.3188, lng: 11.3308 };

/** ~90m north per 0.0008°, which is plenty to order fixtures by without doing trigonometry here. */
function poi(name, klass, northDeg, extra = {}) {
  return {
    name,
    klass,
    subclass: klass,
    lat: CENTRE.lat + northDeg,
    lng: CENTRE.lng,
    ...extra,
  };
}

test("a chip covers every OpenMapTiles class OSM_FILTERS would have matched", () => {
  // The pairs that would be lost by mapping class names one-to-one onto the chip names — which is
  // the obvious implementation and is wrong for half the categories.
  assert.equal(categoryForPoiClass("ice_cream"), "cafe");
  assert.equal(categoryForPoiClass("fast_food"), "restaurant");
  assert.equal(categoryForPoiClass("beer"), "bar");
  assert.equal(categoryForPoiClass("art_gallery"), "museum");
  assert.equal(categoryForPoiClass("garden"), "park");
  assert.equal(categoryForPoiClass("grocery"), "shop");
  assert.equal(categoryForPoiClass("clothing_store"), "shop");

  // Named, findable by typing, never surfaced by a chip.
  assert.equal(categoryForPoiClass("bank"), "place");
  assert.equal(categoryForPoiClass("bus"), "place");
  assert.equal(categoryForPoiClass(""), "place");
});

test("a chip returns its category and nothing else", () => {
  const found = placesFromTiles(
    [
      poi("Nannini", "cafe", 0.0001),
      poi("Gelateria Nice", "ice_cream", 0.0002),
      poi("Osteria Le Logge", "restaurant", 0.0003),
      poi("Banca Monte dei Paschi", "bank", 0.0004),
    ],
    { centre: CENTRE, categories: ["cafe"] }
  );
  assert.deepEqual(
    found.map((p) => p.name),
    ["Nannini", "Gelateria Nice"]
  );
  assert.ok(found.every((p) => p.category === "cafe"));
});

test("no chips means every category, including the ones no chip offers", () => {
  const found = placesFromTiles([poi("Banca Monte dei Paschi", "bank", 0.0001)], {
    centre: CENTRE,
    query: "banca",
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].category, "place");
});

test("free text folds accents and matches the Latin name as well as the local one", () => {
  const pois = [
    poi("Gelatería Nice", "ice_cream", 0.0001),
    poi("京都国立博物館", "museum", 0.0002, { nameLatin: "Kyoto National Museum" }),
    poi("Osteria Le Logge", "restaurant", 0.0003),
  ];

  assert.deepEqual(
    placesFromTiles(pois, { centre: CENTRE, query: "gelateria" }).map((p) => p.name),
    ["Gelatería Nice"]
  );
  // The whole reason `nameLatin` is carried: the tile's `name` here is in a script the traveller
  // cannot type, and the list they are reading shows the Latin one.
  assert.deepEqual(
    placesFromTiles(pois, { centre: CENTRE, query: "kyoto" }).map((p) => p.name),
    ["京都国立博物館"]
  );
  assert.deepEqual(placesFromTiles(pois, { centre: CENTRE, query: "zzz" }), []);
});

test("the same venue in two overlapping tiles survives once", () => {
  // `querySourceFeatures` reads every renderable tile and the `poi` layer is buffered past each
  // tile's edge, so a venue near a boundary genuinely arrives twice — with coordinates that agree
  // to far more decimal places than the key keeps.
  const found = placesFromTiles(
    [poi("Nannini", "cafe", 0.0001), poi("Nannini", "cafe", 0.0001)],
    { centre: CENTRE, categories: ["cafe"] }
  );
  assert.equal(found.length, 1);
});

test("two venues sharing a doorway both survive", () => {
  // Dedupe by position alone would drop one of these — a café inside a museum is one building.
  const found = placesFromTiles(
    [poi("Museo Civico", "museum", 0.0001), poi("Caffè del Museo", "cafe", 0.0001)],
    { centre: CENTRE }
  );
  assert.equal(found.length, 2);
});

test("nearest first, capped at what the list can show", () => {
  const pois = Array.from({ length: 40 }, (_, i) => poi(`Cafe ${i}`, "cafe", (40 - i) * 0.0001));
  const found = placesFromTiles(pois, { centre: CENTRE, categories: ["cafe"] });
  assert.equal(found.length, 15);
  // Built furthest-first on purpose, so an implementation that forgot to sort would fail here.
  assert.equal(found[0].name, "Cafe 39");
  assert.equal(found[14].name, "Cafe 25");
});

test("an area polygon keeps out what the camera cannot see", () => {
  // A box covering only the ground north of the centre.
  const area = [
    { lat: CENTRE.lat, lng: CENTRE.lng - 0.01 },
    { lat: CENTRE.lat + 0.01, lng: CENTRE.lng - 0.01 },
    { lat: CENTRE.lat + 0.01, lng: CENTRE.lng + 0.01 },
    { lat: CENTRE.lat, lng: CENTRE.lng + 0.01 },
  ];
  const found = placesFromTiles(
    [poi("Inside", "cafe", 0.002), poi("Outside", "cafe", -0.002)],
    { centre: CENTRE, categories: ["cafe"], area }
  );
  assert.deepEqual(
    found.map((p) => p.name),
    ["Inside"]
  );

  // Fewer than three points is "no shape", not "an empty shape" — the same fallback every other
  // layer of the search takes, and getting it backwards returns nothing at all, everywhere.
  const unbounded = placesFromTiles([poi("Outside", "cafe", -0.002)], {
    centre: CENTRE,
    categories: ["cafe"],
    area: [area[0], area[1]],
  });
  assert.equal(unbounded.length, 1);
});

test("an id is stable across searches and says where it came from", () => {
  const once = placesFromTiles([poi("Nannini", "cafe", 0.0001)], { centre: CENTRE });
  // Re-searched from somewhere else entirely: the id must not move, or the row's "Added · Day 3"
  // badge — which `addedDays` keys by it — falls off the moment the map is panned.
  const twice = placesFromTiles([poi("Nannini", "cafe", 0.0001)], {
    centre: { lat: 48.8566, lng: 2.3522 },
  });
  assert.equal(once[0].id, twice[0].id);
  assert.ok(isTilePlace(once[0]));
  assert.ok(!isTilePlace({ id: "node/12345" }));
});

test("an unnamed POI is not a search result", () => {
  assert.deepEqual(placesFromTiles([poi("", "cafe", 0.0001)], { centre: CENTRE }), []);
});
