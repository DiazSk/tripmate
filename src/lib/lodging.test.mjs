/* Run: node --test src/lib/lodging.test.mjs
 *
 * `hotelClassForTier` is the load-bearing case, and it is load-bearing for a measured reason:
 * the spike that justified this feature first concluded lodging costs were *overstated* by 55%,
 * because its search was unfiltered and returned a hostel for a luxury trip. Tier-matched
 * inventory showed the opposite — understated by 140%. An unfiltered search does not merely
 * return less useful data, it inverts the answer, so the mapping gets a test.
 *
 * The rest pins the distiller: the raw payload is ~81k tokens of deeply nested search results,
 * and a listing that reaches the prompt without a real price would reopen the exact door this
 * feature closes. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  distilLodgingOptions,
  hotelClassForTier,
  matchLodgingOption,
  reconcileLodging,
} from "./lodging.ts";

/** One property in the shape the search actually returns, verified against a live response. */
function property(overrides = {}) {
  return {
    name: "Rinn Gion Shirakawa",
    hotel_class: "4-star hotel",
    rate_per_night: { lowest: "$265" },
    total_rate: { lowest: "$796" },
    overall_rating: 4.7,
    reviews: 111,
    gps_coordinates: { latitude: 35.0061707, longitude: 135.7727448 },
    ...overrides,
  };
}

const payload = (properties) => ({ results: { properties } });

test("asks for five-star inventory for a luxury trip, and mid classes for mid-range", () => {
  assert.equal(hotelClassForTier("luxury"), "5");
  assert.equal(hotelClassForTier("midrange"), "3,4");
  assert.equal(hotelClassForTier("budget"), "2,3");
});

test("falls back to mid-range rather than searching unfiltered for an unknown tier", () => {
  // An unfiltered search is worse than a wrong-but-narrow one: it returns hostels for a
  // luxury trip and inverts the price comparison entirely.
  assert.equal(hotelClassForTier(undefined), "3,4");
  assert.equal(hotelClassForTier("premium-economy-deluxe"), "3,4");
});

test("reads the real nested response shape", () => {
  const [option] = distilLodgingOptions(payload([property()]));
  assert.equal(option.name, "Rinn Gion Shirakawa");
  assert.equal(option.nightlyUsd, 265);
  assert.equal(option.stayTotalUsd, 796);
  assert.equal(option.hotelClass, "4-star hotel");
  assert.equal(option.rating, 4.7);
  assert.equal(option.reviews, 111);
  assert.equal(option.lat, 35.0061707);
});

test("strips currency formatting from a thousands-separated rate", () => {
  const [option] = distilLodgingOptions(payload([property({ rate_per_night: { lowest: "$2,537" } })]));
  assert.equal(option.nightlyUsd, 2537);
});

test("drops a listing with no price rather than treating it as free", () => {
  // Observed live: "Kyoto Gion Hotel" came back with rate_per_night null. A listing with no
  // price cannot anchor the budget, and a 0 would read downstream as a free room.
  const options = distilLodgingOptions(
    payload([property({ name: "No Price Inn", rate_per_night: { lowest: null } }), property()]),
  );
  assert.equal(options.length, 1);
  assert.equal(options[0].name, "Rinn Gion Shirakawa");
});

test("drops a listing with no name", () => {
  assert.deepEqual(distilLodgingOptions(payload([property({ name: "  " })])), []);
});

test("keeps a priced listing whose optional fields are all missing", () => {
  const [option] = distilLodgingOptions(
    payload([
      {
        name: "Large studio with view of the Eiffel Tower",
        rate_per_night: { lowest: "$159" },
      },
    ]),
  );
  assert.equal(option.nightlyUsd, 159);
  assert.equal(option.hotelClass, null);
  assert.equal(option.stayTotalUsd, null);
  assert.equal(option.rating, null);
  assert.equal(option.lat, null);
});

test("derives a class label from the numeric-only field", () => {
  const [option] = distilLodgingOptions(
    payload([property({ hotel_class: undefined, extracted_hotel_class: 5 })]),
  );
  assert.equal(option.hotelClass, "5-star");
});

test("caps how many options reach the prompt", () => {
  const many = Array.from({ length: 40 }, (_, i) => property({ name: `Hotel ${i}` }));
  assert.equal(distilLodgingOptions(many.length ? payload(many) : payload([])).length, 5);
  assert.equal(distilLodgingOptions(payload(many), 2).length, 2);
});

test("tolerates a malformed payload without throwing", () => {
  // A malformed reply is a failed lookup, not a crash — the caller degrades on [] the same
  // way it degrades on a genuinely empty search.
  assert.deepEqual(distilLodgingOptions(null), []);
  assert.deepEqual(distilLodgingOptions({}), []);
  assert.deepEqual(distilLodgingOptions({ results: { properties: "nope" } }), []);
  assert.deepEqual(distilLodgingOptions(payload([null, 42, "x"])), []);
});

/* `reconcileLodging` is the deterministic backstop for a failure observed live: with the real
 * list, the correct pricing basis, and an explicit "do not invent" rule all present in the
 * prompt, the model still invented "Hotel Jeanne d'Arc Le Marais @ $140" once the cheapest real
 * option didn't fit the stated budget. A prompt is a request, not a constraint, so this checks
 * the model's output against the real list and repairs what doesn't match. */

const paris = [
  { name: "Boutet Bastille Hotel Paris - MGallery Collection", hotelClass: "5-star tourist hotel", nightlyUsd: 377, stayTotalUsd: 377, rating: 4.4, reviews: 1168, lat: 48.85, lon: 2.38 },
  { name: "Château des Fleurs Hôtel & Spa Paris", hotelClass: "5-star tourist hotel", nightlyUsd: 671, stayTotalUsd: 671, rating: 4.7, reviews: 334, lat: 48.87, lon: 2.30 },
  { name: "Ritz Paris", hotelClass: "5-star tourist hotel", nightlyUsd: 2616, stayTotalUsd: 2616, rating: 4.6, reviews: 4592, lat: 48.87, lon: 2.33 },
];

test("matches a name the model copied verbatim from the list", () => {
  assert.equal(matchLodgingOption("Ritz Paris", paris)?.nightlyUsd, 2616);
});

test("matches through accents and punctuation the model may have dropped", () => {
  assert.equal(matchLodgingOption("Chateau des Fleurs Hotel Spa Paris", paris)?.nightlyUsd, 671);
});

test("matches a shortened form of a listed name", () => {
  assert.equal(matchLodgingOption("Boutet Bastille Hotel", paris)?.nightlyUsd, 377);
});

test("returns null for a name that names no listed property", () => {
  // This is the actual failure this feature guards: the model invented an entirely different
  // hotel rather than picking one from the list.
  assert.equal(matchLodgingOption("Hotel Jeanne d'Arc Le Marais", paris), null);
});

test("returns null for empty input rather than matching everything", () => {
  assert.equal(matchLodgingOption("", paris), null);
  assert.equal(matchLodgingOption("   ", paris), null);
});

test("passes a correctly-named lodging through unchanged", () => {
  const lodging = { name: "Ritz Paris", cost: 2616, note: "Iconic, on the traveler's list of once-in-a-lifetime stays." };
  const out = reconcileLodging(lodging, paris, 3000);
  assert.equal(out, lodging); // same reference: no repair needed, nothing rewritten
});

test("pins the price when the model named a real property but drifted on its rate", () => {
  const lodging = { name: "Ritz Paris", cost: 300, note: "Legendary, central." };
  const out = reconcileLodging(lodging, paris, 3000);
  assert.equal(out.cost, 2616);
  assert.equal(out.name, "Ritz Paris");
  assert.equal(out.note, "Legendary, central."); // a price drift keeps the model's own note
});

test("replaces an invented property with the cheapest real one", () => {
  const lodging = { name: "Hotel Jeanne d'Arc Le Marais", cost: 140, note: "Fits the budget perfectly." };
  const out = reconcileLodging(lodging, paris, 1000);
  assert.equal(out.name, "Boutet Bastille Hotel Paris - MGallery Collection");
  assert.equal(out.cost, 377);
  assert.doesNotMatch(out.note, /Fits the budget perfectly/); // the false pretext does not survive
});

test("says so when even the cheapest real option overshoots the budget", () => {
  // Real case: cheapest 5-star Paris lodging is $377/night against a $300 budget.
  const lodging = { name: "Hotel Jeanne d'Arc Le Marais", cost: 140, note: "Fits the budget perfectly." };
  const out = reconcileLodging(lodging, paris, 300);
  assert.match(out.note, /377/);
  assert.match(out.note, /above the stated budget/);
});

test("is a no-op when there is nothing to check the name against", () => {
  const lodging = { name: "Hotel Jeanne d'Arc Le Marais", cost: 140, note: "n/a" };
  assert.equal(reconcileLodging(lodging, null, 1000), lodging);
  assert.equal(reconcileLodging(lodging, [], 1000), lodging);
});
