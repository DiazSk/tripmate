/* Run: node --test src/lib/destinationFestivals.test.mjs
 *
 * The regression that matters most here is the gate, not the extraction: when the search
 * returns nothing usable, `fetchFestivals` must return `[]` from code and never attempt a model
 * call at all. An LLM asked to "find festivals" with no real material in front of it is exactly
 * the bug this module replaces — the fix is making that structurally impossible, not just
 * discouraged by a prompt instruction. `hasExtractableContent` is the pure gate that makes it
 * testable without a live call. The extraction prompt itself is tested for the constraints that
 * keep it bounded: cite by number, never invent a date the source doesn't state. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildFestivalExtractionPrompt, hasExtractableContent } from "./destinationFestivals.ts";

/** Brave web search shape for "festivals events in Paris September 2026". Not live-verified —
 * BRAVE_API_KEY was unavailable in this environment; coded against documented/expected shape
 * (`{ web: { results: [{ title, url, description }] } }`). Spot-check once a real key exists. */
const realResponse = {
  web: {
    results: [
      {
        title: "Asian Street Food Festival, 6e édition - Ville de Paris",
        url: "https://www.paris.fr/evenements/asian-street-food-festival-6e-edition",
        description: "Asian Street Food Festival runs September 5 to 6, 2026 in Paris.",
      },
      {
        title: "Festival Traversées du Marais 2026 - Ville de Paris",
        url: "https://www.paris.fr/evenements/festival-traversees-du-marais-2026",
        description: "Traversées du Marais takes place September 4 to 6, 2026.",
      },
    ],
  },
};

test("recognizes real search output as extractable", () => {
  assert.equal(hasExtractableContent(realResponse), true);
});

test("treats an empty-results response as nothing to extract", () => {
  // Assumed shape (unverified — no BRAVE_API_KEY available): an empty result set still nests
  // under `web.results` as an empty array, and a response omitting `web` entirely also degrades
  // to nothing extractable.
  assert.equal(hasExtractableContent({ web: { results: [] } }), false);
  assert.equal(hasExtractableContent({}), false);
});

test("requires both a title and description on at least one result", () => {
  // A result missing either field can't produce a usable numbered line — treat it as unusable
  // rather than extracting from a partial entry.
  assert.equal(hasExtractableContent({ web: { results: [{ title: "x", url: "y" }] } }), false);
  assert.equal(hasExtractableContent({ web: { results: [{ description: "x", url: "y" }] } }), false);
  assert.equal(
    hasExtractableContent({ web: { results: [{ title: "  ", description: "", url: "y" }] } }),
    false
  );
});

test("tolerates a malformed payload without throwing", () => {
  assert.equal(hasExtractableContent(null), false);
  assert.equal(hasExtractableContent({ web: {} }), false);
  assert.equal(hasExtractableContent({ web: { results: "nope" } }), false);
  assert.equal(hasExtractableContent({ web: { results: [null, 42] } }), false);
});

test("the extraction prompt instructs citing by number, never guessing a date", () => {
  const prompt = buildFestivalExtractionPrompt(
    "[1] Asian Street Food Festival, 6e édition - Ville de Paris: Asian Street Food Festival runs September 5 to 6, 2026 in Paris.",
    [
      {
        title: realResponse.web.results[0].title,
        url: realResponse.web.results[0].url,
      },
    ]
  );
  assert.match(prompt, /Asian Street Food Festival/); // the real text is actually included
  assert.match(prompt, /omit that item entirely rather than guessing/);
  assert.match(prompt, /Do not add any festival, date, or detail that is not present/);
  assert.match(prompt, /\[1\]/); // citation numbering is explained
});

test("the extraction prompt carries the real citation URL, not a placeholder", () => {
  const prompt = buildFestivalExtractionPrompt("text", [{ title: "Real Site", url: "https://real.example/x" }]);
  assert.match(prompt, /https:\/\/real\.example\/x/);
});
