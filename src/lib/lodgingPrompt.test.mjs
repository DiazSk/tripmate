/* Run: node --test src/lib/lodgingPrompt.test.mjs
 *
 * The load-bearing case is that the two instructions never ship together. The no-data text
 * forbids naming a specific property and forbids stating a price; the real-data text requires
 * both. Merged into one prompt they contradict each other outright, and this codebase's observed
 * failure mode is the model resolving a contradiction by inventing — which is the defect the
 * real data exists to remove. So `lodgingInstruction` is a function with two exclusive branches,
 * and these tests are what stop it collapsing back into one appended constant.
 *
 * The overshoot escape is the other case worth pinning: real prices make the 85-100% budget
 * target genuinely unreachable on some trips (a measured example needed $2,793 of real lodging
 * against a $1,000 budget), and without an explicit escape the only way to satisfy the target is
 * to invent a cheaper hotel. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  budgetInstruction,
  formatLodging,
  lodgingInstruction,
  lodgingPricingBasis,
} from "./lodgingPrompt.ts";

const option = (overrides = {}) => ({
  name: "Rinn Gion Shirakawa",
  hotelClass: "4-star hotel",
  nightlyUsd: 265,
  stayTotalUsd: 796,
  rating: 4.7,
  reviews: 111,
  lat: 35.0061707,
  lon: 135.7727448,
  ...overrides,
});

test("says nothing when the lookup failed or found nothing", () => {
  // null = lookup failed, [] = searched fine but this tier has nothing here (observed: no
  // 5-star results for Zurich). Both must leave the prompt exactly as it was before.
  assert.equal(formatLodging(null), "");
  assert.equal(formatLodging([]), "");
});

test("puts the real name, rate and class in front of the model", () => {
  const out = formatLodging([option()]);
  assert.match(out, /Rinn Gion Shirakawa/);
  assert.match(out, /\$265\/night/);
  assert.match(out, /4-star hotel/);
});

test("carries the whole-stay total, which is what the budget is actually spent against", () => {
  assert.match(formatLodging([option()]), /\$796 for the whole stay/);
});

test("says the list is already tier-filtered", () => {
  // Without this the model has no way to know the list is not simply the cheapest nearby.
  assert.match(formatLodging([option()]), /tier/i);
});

test("omits fields a listing does not have, rather than printing a blank", () => {
  const out = formatLodging([
    option({ hotelClass: null, stayTotalUsd: null, rating: null, reviews: null }),
  ]);
  assert.match(out, /unclassified/);
  assert.doesNotMatch(out, /for the whole stay/);
  assert.doesNotMatch(out, /rated/);
});

test("renders a rating without a review count when only the rating is known", () => {
  const out = formatLodging([option({ reviews: null })]);
  assert.match(out, /rated 4\.7/);
  assert.doesNotMatch(out, /reviews/);
});

test("lists every option it was given", () => {
  const out = formatLodging([option(), option({ name: "Luxury hotel SOWAKA", nightlyUsd: 864 })]);
  assert.match(out, /Rinn Gion Shirakawa/);
  assert.match(out, /Luxury hotel SOWAKA/);
});

test("keeps the type-first hedge when there is no real data", () => {
  const out = lodgingInstruction(false);
  assert.match(out, /choose the TYPE of stay/);
  assert.match(out, /invents one that may not exist/);
  assert.match(out, /Never invent specific prices/);
});

test("drops the type-first hedge once real properties are listed", () => {
  // This is the test that stops the two instructions being merged back together.
  const out = lodgingInstruction(true);
  assert.doesNotMatch(out, /choose the TYPE of stay/);
  assert.doesNotMatch(out, /invents one that may not exist/);
  assert.doesNotMatch(out, /Never invent specific prices/);
});

test("tells the model to use a listed property at its listed rate", () => {
  const out = lodgingInstruction(true);
  assert.match(out, /ONE property from the real lodging list/);
  assert.match(out, /listed nightly rate IS the cost/);
  assert.match(out, /not invent a property that is not on that list/i);
});

test("lets the real rate overshoot the budget instead of inventing a cheaper stay", () => {
  const out = lodgingInstruction(true);
  assert.match(out, /overshoots/);
  assert.match(out, /does NOT license substituting a cheaper invented property/);
});

test("still offers a way out when nothing listed suits the trip", () => {
  assert.match(lodgingInstruction(true), /If none of the listed options suits the trip/);
});

test("offers no competing pricing basis once real rates are listed", () => {
  // The regression this guards is the one that actually happened: with "priced to the style
  // above" still in the prompt alongside five listed 5-star Paris properties, the model ignored
  // the list and invented a $195 hotel. Two pricing bases means the abstract one can win.
  assert.match(lodgingPricingBasis(true), /exact nightly rate from the real lodging list/);
  assert.doesNotMatch(lodgingPricingBasis(true), /style/);
  assert.equal(lodgingPricingBasis(false), "priced to the style above");
});

test("keeps the unqualified budget target when lodging is only an estimate", () => {
  const out = budgetInstruction(false);
  assert.match(out, /MUST come close to the full stated budget/);
  assert.match(out, /85-100%/);
});

test("makes a real lodging rate fixed rather than something to adjust down", () => {
  const out = budgetInstruction(true);
  assert.match(out, /fixed/);
  assert.doesNotMatch(out, /MUST come close to the full stated budget/);
  assert.match(out, /never be adjusted, rounded down, or swapped/);
});

test("prefers a visible overshoot over a total that only fits by fabrication", () => {
  // Real 5-star Mumbai lodging is $2,793 against a $1,000 budget: no honest plan hits the band,
  // so the target must yield rather than the price.
  const out = budgetInstruction(true);
  assert.match(out, /by how much it overshoots/);
  assert.match(out, /honest overshoot is a correct answer/);
});
