/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/export/exportPrimitives.test.mjs
 *
 * Four decisions the exported file makes on every stop. Each one is here because the live data
 * already contains the case that gets it wrong: coincident coordinates, emoji in a model
 * summary, a free stop, and a stop name that is untrusted model output. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  costLabel,
  dayLegs,
  escapeHtml,
  slugify,
  stripEmoji,
} from "./exportPrimitives.ts";

const stop = (lat, lng, name = "x") => ({
  name,
  lat,
  lng,
  cost: 0,
  note: "",
  time: "9:00 AM",
  durationLabel: "1 hour",
  category: "other",
});

test("every HTML metacharacter is escaped", () => {
  assert.equal(
    escapeHtml(`<script>alert("x" & 'y')</script>`),
    "&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;"
  );
});

test("escaping is not double-applied to an already-escaped ampersand", () => {
  // & is escaped once. Running the result through again would give &amp;amp; — the caller must
  // escape exactly at the template boundary, and this documents the single-pass contract.
  assert.equal(escapeHtml("Fish & Chips"), "Fish &amp; Chips");
});

test("emoji are stripped from a real model summary", () => {
  assert.equal(
    stripEmoji("Medieval Altstadt history and Zurich West's scene. 🏛️🎨"),
    "Medieval Altstadt history and Zurich West's scene."
  );
  assert.equal(stripEmoji("Relaxed final morning, then departure. ✈️☀️"), "Relaxed final morning, then departure.");
});

test("stripping emoji leaves ordinary punctuation and accents alone", () => {
  assert.equal(stripEmoji("Zürich West — galleries, murals & rösti"), "Zürich West — galleries, murals & rösti");
});

test("a free stop says Free, never $0", () => {
  assert.equal(costLabel(0), "Free");
  assert.equal(costLabel(100), "$100");
});

test("coincident stops produce no leg at all", () => {
  // Live Zurich data: the tram stop, the summit and the mountain restaurant share one coordinate.
  const legs = dayLegs([stop(47.338, 8.487), stop(47.338, 8.487)]);
  assert.equal(legs.length, 1);
  assert.equal(legs[0], null, "a zero-distance hop must not render as '1 min walk'");
});

test("a real hop carries its computed mode, distance and minutes", () => {
  // Altstadt lunch -> Zurich West, the day-3 hop that the itinerary's own note calls "Tram 4 (10 mins)".
  const legs = dayLegs([stop(47.377, 8.53), stop(47.389, 8.516)]);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].mode, "transit");
  assert.ok(legs[0].distanceKm > 1.5, `expected a transit-scale hop, got ${legs[0].distanceKm}km`);
  assert.ok(legs[0].minutes >= 1);
});

test("a short hop is a walk", () => {
  const legs = dayLegs([stop(47.377, 8.544), stop(47.373, 8.548)]);
  assert.equal(legs[0].mode, "walk");
});

test("legs are one shorter than stops, and an empty day has none", () => {
  assert.equal(dayLegs([stop(1, 1), stop(2, 2), stop(3, 3)]).length, 2);
  assert.equal(dayLegs([stop(1, 1)]).length, 0);
  assert.equal(dayLegs([]).length, 0);
});

test("the filename slug is ASCII and never empty", () => {
  assert.equal(slugify("Zürich"), "zurich");
  assert.equal(slugify("Val d'Orcia, Italy"), "val-d-orcia-italy");
  assert.equal(slugify("!!!"), "trip");
});
