/* Run: node --test src/lib/flights.test.mjs
 *
 * The load-bearing case is `computeEffectiveBudget`'s floor: a real flight cost that meets or
 * exceeds the whole stated budget must NOT produce a negative or near-zero planning budget — that
 * would make "plan lodging and stops against what's left" nonsensical. The rest pins the reader
 * against the real COMPOSIO_SEARCH_FLIGHTS shape verified live: `price_insights.lowest_price`
 * already matches the cheapest listed flight, so it's read directly rather than picked out of a
 * list the way lodging options are. */
import assert from "node:assert/strict";
import test from "node:test";
import { computeEffectiveBudget, distilFlightEstimate } from "./flights.ts";

/** Verified live: Boston -> Paris, round trip, 2 adults. */
const realResponse = {
  results: {
    best_flights: [{ price: 1455, total_duration: 570, flights: [{ airline: "Air Canada" }] }],
    other_flights: [{ price: 1485, total_duration: 677, flights: [{ airline: "United" }] }],
    price_insights: { lowest_price: 1455, price_level: "typical", typical_price_range: [1050, 1550] },
  },
};

test("reads the total straight from price_insights, not by picking through listed flights", () => {
  const estimate = distilFlightEstimate(realResponse);
  assert.equal(estimate.costUsd, 1455);
  assert.equal(estimate.priceLevel, "typical");
  assert.deepEqual(estimate.typicalRangeUsd, [1050, 1550]);
});

test("returns null when there is no price_insights block to read", () => {
  assert.equal(distilFlightEstimate({ results: { best_flights: [] } }), null);
  assert.equal(distilFlightEstimate({ results: {} }), null);
  assert.equal(distilFlightEstimate(null), null);
});

test("treats a zero or negative lowest_price as unusable rather than a free flight", () => {
  assert.equal(
    distilFlightEstimate({ results: { price_insights: { lowest_price: 0 } } }),
    null
  );
});

test("tolerates a malformed typical_price_range without throwing", () => {
  const junk = { results: { price_insights: { lowest_price: 500, typical_price_range: "nope" } } };
  assert.equal(distilFlightEstimate(junk).typicalRangeUsd, null);
});

test("subtracts a real flight cost from the stated budget", () => {
  assert.equal(computeEffectiveBudget(1500, { costUsd: 1455, priceLevel: null, typicalRangeUsd: null }), 45);
});

test("leaves the budget untouched when there is no flight estimate at all", () => {
  // The majority case for a while: no origin given, so nothing to subtract.
  assert.equal(computeEffectiveBudget(1500, null), 1500);
});

test("never produces a negative or nonsensical planning budget", () => {
  // A real case this session found: Boston -> Paris round trip for 2 is $1,455, which can
  // exceed a modest stated budget outright. Subtracting would leave nothing to plan a trip with.
  assert.equal(computeEffectiveBudget(1000, { costUsd: 1455, priceLevel: null, typicalRangeUsd: null }), 1000);
  assert.equal(computeEffectiveBudget(1455, { costUsd: 1455, priceLevel: null, typicalRangeUsd: null }), 1455);
});
