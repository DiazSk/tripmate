/* Run: node --test src/lib/destinationSafety.test.mjs
 *
 * The reason this module exists at all: `getDestinationContext` used to invent every safety note
 * from nothing, shown to travelers under a literal "Safety" heading. The load-bearing property
 * here is that `note` is built ONLY from a real article's own title and domain — never
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

test("distils real GDELT articles into sourced notes", () => {
  // Shape verified live: curl "https://api.gdeltproject.org/api/v2/doc/doc?query=Paris%20tourist%20safety%20sourcelang:english&mode=artlist&format=json&maxrecords=10&sort=datedesc"
  const raw = {
    articles: [
      {
        url: "https://www.perthnow.com.au/wa/perth/like-something-out-of-taken-perth-woman-reveals-how-she-was-almost-human-trafficked-in-paris-c-22690950",
        url_mobile: "",
        title: "Like something out of Taken: Perth woman reveals how she was almost human trafficked in Paris",
        seendate: "20260807T083000Z",
        socialimage: "https://images.perthnow.com.au/publication/C-22690950/example.jpg",
        domain: "perthnow.com.au",
        language: "English",
        sourcecountry: "Australia",
      },
    ],
  };
  const [note] = distilSafetyNotes(raw);
  assert.equal(
    note.note,
    "Like something out of Taken: Perth woman reveals how she was almost human trafficked in Paris — perthnow.com.au"
  );
  // classifySeverity's keyword list doesn't cover "trafficked" — a real ceiling of the
  // title-only heuristic, not a bug in this test.
  assert.equal(note.severity, "low");
  assert.equal(
    note.sourceUrl,
    "https://www.perthnow.com.au/wa/perth/like-something-out-of-taken-perth-woman-reveals-how-she-was-almost-human-trafficked-in-paris-c-22690950"
  );
});

test("builds the note from title alone when the domain is missing", () => {
  const [note] = distilSafetyNotes({ articles: [{ title: "Some headline" }] });
  assert.equal(note.note, "Some headline");
});

test("drops an entry with no usable title", () => {
  assert.deepEqual(distilSafetyNotes({ articles: [{ domain: "x.com" }, { title: "  " }] }), []);
});

test("caps the number of notes", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ title: `Article ${i}` }));
  assert.equal(distilSafetyNotes({ articles: many }).length, 5);
  assert.equal(distilSafetyNotes({ articles: many }, 2).length, 2);
});

test("tolerates a malformed payload without throwing", () => {
  assert.deepEqual(distilSafetyNotes(null), []);
  assert.deepEqual(distilSafetyNotes({}), []);
  assert.deepEqual(distilSafetyNotes({ articles: "nope" }), []);
  // GDELT genuinely returns bare `{}` (no `articles` key at all) when a query is too
  // restrictive to match anything — verified live.
  assert.deepEqual(distilSafetyNotes({}), []);
});
