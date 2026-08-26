/* Run: node --test src/lib/placeFacts.test.mjs
 *
 * The load-bearing case is that BOTH response shapes distil. The same Google Maps tool returns
 * hours under `operating_hours` (an object) for a search query and under `hours` (an array of
 * single-key objects) for a named place — and enriching a generated stop is always the second
 * case. A distiller handling only the first returns no hours while looking exactly like a place
 * that publishes none, which is how this was nearly shipped: the first live probe of "Louvre
 * Museum Paris" read `operating_hours: null` until the real field was found.
 *
 * Admission is the other case worth pinning: it arrives per provider, and a reseller's bundled
 * "with Seine River Cruise" ticket is not what entry costs. */
import assert from "node:assert/strict";
import test from "node:test";
import { distilPlaceFacts, titleMatches } from "./placeFacts.ts";

/** Verified live: shape returned for a named-place query. */
const namedPlace = {
  results: {
    place_results: {
      title: "Louvre Museum",
      rating: 4.7,
      hours: [
        { sunday: "9 AM–6 PM" },
        { monday: "9 AM–6 PM" },
        { tuesday: "Closed" },
        { wednesday: "9 AM–9 PM" },
        { thursday: "9 AM–6 PM" },
        { friday: "9 AM–9 PM" },
        { saturday: "9 AM–6 PM" },
      ],
      admission: [
        { title: "Louvre Museum", options: [{ title: "General Adult Admission", extracted_price: 37.39, official_site: true }] },
        { title: "Klook", options: [{ title: "Louvre Museum Ticket", extracted_price: 35.05, official_site: null }] },
      ],
      extensions: [
        { accessibility: ["Wheelchair accessible entrance", "Wheelchair accessible restroom"] },
        { planning: ["Getting tickets in advance recommended"] },
      ],
    },
  },
};

/** Verified live: shape returned for a search-style query. */
const searchResult = {
  results: {
    local_results: [
      {
        title: "ZIRAEL Vegan Restaurant",
        rating: 4.9,
        operating_hours: { monday: "9–11 AM, 12–3 PM, 5–8 PM", tuesday: "12–3 PM, 5–8 PM" },
        extensions: [{ accessibility: ["Wheelchair accessible seating"] }],
      },
    ],
  },
};

test("distils the named-place shape, where hours are an array of single-key objects", () => {
  const facts = distilPlaceFacts(namedPlace);
  assert.equal(facts.hoursByDay.tuesday, "Closed");
  assert.equal(facts.hoursByDay.wednesday, "9 AM–9 PM");
  assert.equal(Object.keys(facts.hoursByDay).length, 7);
});

test("distils the search shape, where the same data is an object under a different key", () => {
  const facts = distilPlaceFacts(searchResult);
  assert.equal(facts.hoursByDay.monday, "9–11 AM, 12–3 PM, 5–8 PM");
  assert.equal(facts.rating, 4.9);
});

test("prefers the venue's official admission over a reseller's bundle", () => {
  assert.equal(distilPlaceFacts(namedPlace).admissionUsd, 37.39);
});

test("reports no price at all when only resellers list one", () => {
  // Regression, and it shipped a wrong number before being caught: the free Jardin du Luxembourg
  // has no official admission but several resellers selling guided walks, so a cheapest-reseller
  // fallback returned $11.10 and pinned it onto a stop that costs nothing to enter. No official
  // price means the model's own estimate is the better answer.
  const noOfficial = structuredClone(namedPlace);
  noOfficial.results.place_results.admission[0].options[0].official_site = null;
  assert.equal(distilPlaceFacts(noOfficial).admissionUsd, null);
});

test("reads accessibility out of the single-key extensions array", () => {
  assert.deepEqual(distilPlaceFacts(namedPlace).accessibility, [
    "Wheelchair accessible entrance",
    "Wheelchair accessible restroom",
  ]);
});

test("picks up the book-ahead signal §14c asks for", () => {
  assert.equal(distilPlaceFacts(namedPlace).bookAhead, true);
  assert.equal(distilPlaceFacts(searchResult).bookAhead, false);
});

test("treats a payload with nothing usable as a failed lookup", () => {
  // Indistinguishable from a network failure on purpose: both degrade identically.
  assert.equal(distilPlaceFacts(null), null);
  assert.equal(distilPlaceFacts({}), null);
  assert.equal(distilPlaceFacts({ results: {} }), null);
  assert.equal(distilPlaceFacts({ results: { place_results: { title: "x" } } }), null);
});

test("tolerates malformed hours and admission without throwing", () => {
  const junk = { results: { place_results: { rating: 4.1, hours: "nope", admission: "nope", extensions: "nope" } } };
  const facts = distilPlaceFacts(junk);
  assert.equal(facts.hoursByDay, null);
  assert.equal(facts.admissionUsd, null);
  assert.deepEqual(facts.accessibility, []);
});

test("prefers the real weekday map over a same-named status string", () => {
  // Regression: `local_results[]` carries `hours` as a status string ("Closed · Opens 9 AM Mon")
  // alongside `operating_hours` as the real map. A `??` chain took the string, failed to parse it,
  // and silently reported no hours for a place that publishes them — caught only because a raw
  // API probe disagreed with the client for the identical query.
  const both = {
    results: {
      local_results: [
        {
          title: "Louvre Museum",
          hours: "Closed · Opens 9 AM Mon",
          operating_hours: { tuesday: "Closed", wednesday: "9 AM–9 PM" },
        },
      ],
    },
  };
  const facts = distilPlaceFacts(both);
  assert.equal(facts.hoursByDay.tuesday, "Closed");
  assert.equal(facts.hoursByDay.wednesday, "9 AM–9 PM");
});

test("accepts a listing whose title the model decorated", () => {
  // The model names stops descriptively, so the real listing title is usually a substring.
  assert.equal(titleMatches("Louvre Museum Private Tour", "Louvre Museum"), true);
  assert.equal(titleMatches("Eiffel Tower Summit", "Eiffel Tower"), true);
  assert.equal(titleMatches("Chateau des Fleurs", "Château des Fleurs"), true);
});

test("rejects a nearby business the fuzzy search wandered onto", () => {
  // Verified live: probing "Louvre Museum Private Tour" anchored at the Louvre's coordinates
  // returned "Explore Paris Tours" — a tour operator with its own hours. Attaching those to a
  // Louvre visit is a confidently wrong closure, worse than having no hours at all.
  assert.equal(titleMatches("Louvre Museum Private Tour", "Explore Paris Tours"), false);
  assert.equal(titleMatches("Louvre Museum", null), false);
  assert.equal(titleMatches("", "Louvre Museum"), false);
});

test("reads hourly busyness out of popular_times, keyed by weekday", () => {
  // Shape verified live against the Eiffel Tower: real hourly busyness scores.
  const withCrowd = {
    results: {
      place_results: {
        title: "Eiffel Tower",
        popular_times: {
          current_day: "sunday",
          graph_results: {
            tuesday: [
              { busyness_score: 0, time: "6 AM" },
              { busyness_score: 20, info: "Usually not too busy", time: "9 AM" },
              { busyness_score: 33, info: "Usually not too busy", time: "10 AM" },
            ],
          },
        },
      },
    },
  };
  const facts = distilPlaceFacts(withCrowd);
  assert.equal(facts.crowdByDay.tuesday.length, 3);
  assert.equal(facts.crowdByDay.tuesday[1].time, "9 AM");
  assert.equal(facts.crowdByDay.tuesday[1].busyness, 20);
});

test("popular_times is absent for most places, and that is a real answer, not a failure", () => {
  const noCrowd = { results: { place_results: { title: "Small Museum", rating: 4.2 } } };
  assert.equal(distilPlaceFacts(noCrowd).crowdByDay, null);
});

test("tolerates a malformed popular_times without throwing", () => {
  const junk = { results: { place_results: { rating: 4.1, popular_times: "nope" } } };
  assert.equal(distilPlaceFacts(junk).crowdByDay, null);
  const junk2 = { results: { place_results: { rating: 4.1, popular_times: { graph_results: "nope" } } } };
  assert.equal(distilPlaceFacts(junk2).crowdByDay, null);
});
