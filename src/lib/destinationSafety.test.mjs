/* Run: node --test src/lib/destinationSafety.test.mjs
 *
 * The reason this module exists at all: `getDestinationContext` used to invent every safety note
 * from nothing, shown to travelers under a literal "Safety" heading. The load-bearing property
 * here is that `note` is built ONLY from a real article's own title and source — never
 * model-written — so every word a traveler reads traces back to something a real outlet actually
 * published. `classifySeverity` is a keyword heuristic with a real ceiling, but a heuristic
 * grounded in real text is strictly better than a severity invented from nothing. */
import assert from "node:assert/strict";
import test from "node:test";
import { classifySeverity, distilSafetyNotes } from "./destinationSafety.ts";

test("classifies real headline language into the right band", () => {
  // Verified live against actual Paris-safety coverage.
  assert.equal(classifySeverity("I Was Pickpocketed When I Moved to Paris"), "medium");
  assert.equal(classifySeverity("European Capitals Tighten Security to Protect Tourists from Scams"), "medium");
  assert.equal(classifySeverity("US State Department issues do not travel advisory after terrorist attack"), "high");
  assert.equal(classifySeverity("10 Best Cafes to Try on Your First Trip to Lisbon"), "low");
});

test("distils real news results into sourced notes", () => {
  // Shape verified live against COMPOSIO_SEARCH_NEWS.
  const raw = {
    news_results: [
      {
        title: "I Was Pickpocketed When I Moved to Paris",
        source: "Travel + Leisure",
        snippet: "anti-theft devices",
        link: "https://example.com/a",
        published_at: "2026-07-07 07:00:00 UTC",
      },
    ],
  };
  const [note] = distilSafetyNotes(raw);
  assert.equal(note.note, "I Was Pickpocketed When I Moved to Paris — Travel + Leisure");
  assert.equal(note.severity, "medium");
  assert.equal(note.sourceUrl, "https://example.com/a");
});

test("builds the note from title alone when the source is missing", () => {
  const [note] = distilSafetyNotes({ news_results: [{ title: "Some headline" }] });
  assert.equal(note.note, "Some headline");
});

test("drops an entry with no usable title", () => {
  assert.deepEqual(distilSafetyNotes({ news_results: [{ source: "X" }, { title: "  " }] }), []);
});

test("caps the number of notes", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ title: `Article ${i}` }));
  assert.equal(distilSafetyNotes({ news_results: many }).length, 5);
  assert.equal(distilSafetyNotes({ news_results: many }, 2).length, 2);
});

test("tolerates a malformed payload without throwing", () => {
  assert.deepEqual(distilSafetyNotes(null), []);
  assert.deepEqual(distilSafetyNotes({}), []);
  assert.deepEqual(distilSafetyNotes({ news_results: "nope" }), []);
});
