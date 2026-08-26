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

/** Verified live against COMPOSIO_SEARCH_WEB for "festivals events in Paris September 2026". */
const realResponse = {
  answer:
    "Paris hosts numerous festivals throughout September 2026. Early in the month, you can attend the Asian Street Food Festival [1] from September 5 to 6, as well as the Traversées du Marais [2] from September 4 to 6.",
  citations: [
    { title: "Asian Street Food Festival, 6e édition - Ville de Paris", url: "https://www.paris.fr/evenements/asian-street-food-festival-6e-edition" },
    { title: "Festival Traversées du Marais 2026 - Ville de Paris", url: "https://www.paris.fr/evenements/festival-traversees-du-marais-2026" },
  ],
};

test("recognizes real search output as extractable", () => {
  assert.equal(hasExtractableContent(realResponse), true);
});

test("treats Google's own empty-results shape as nothing to extract", () => {
  // Verified live: the structured events tool returns this shape for forward dates, and a plain
  // web search with no results looks the same — an empty answer, no citations.
  assert.equal(hasExtractableContent({ error: "Google hasn't returned any results for this query." }), false);
  assert.equal(hasExtractableContent({ answer: "", citations: [] }), false);
  assert.equal(hasExtractableContent({ answer: "   ", citations: [{ title: "x", url: "y" }] }), false);
});

test("requires citations even if the answer text is non-empty", () => {
  // An answer with no citations has no way to attribute a source — treat it as unusable rather
  // than extracting an unsourced claim.
  assert.equal(hasExtractableContent({ answer: "Something happens in September.", citations: [] }), false);
});

test("tolerates a malformed payload without throwing", () => {
  assert.equal(hasExtractableContent(null), false);
  assert.equal(hasExtractableContent({}), false);
  assert.equal(hasExtractableContent({ answer: 42, citations: "nope" }), false);
});

test("the extraction prompt instructs citing by number, never guessing a date", () => {
  const prompt = buildFestivalExtractionPrompt(realResponse.answer, [
    { title: realResponse.citations[0].title, url: realResponse.citations[0].url },
  ]);
  assert.match(prompt, /Asian Street Food Festival/); // the real text is actually included
  assert.match(prompt, /omit that item entirely rather than guessing/);
  assert.match(prompt, /Do not add any festival, date, or detail that is not present/);
  assert.match(prompt, /\[1\]/); // citation numbering is explained
});

test("the extraction prompt carries the real citation URL, not a placeholder", () => {
  const prompt = buildFestivalExtractionPrompt("text", [{ title: "Real Site", url: "https://real.example/x" }]);
  assert.match(prompt, /https:\/\/real\.example\/x/);
});
