/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/wikiTitle.test.mjs
 *
 * Only the pure half is covered. `resolveTitle` is a network call and belongs to Wikipedia;
 * which candidates we try, and which hits we are willing to believe, are ours. */
import assert from "node:assert/strict";
import test from "node:test";
import { candidateQueries, foldDiacritics, passesContainment, wideImage } from "./wikiTitle.ts";

test("romanization variants match", () => {
  assert.equal(foldDiacritics("Tenryū-ji"), "Tenryu-ji");
  assert.equal(foldDiacritics("Zürich"), "Zurich");
  assert.equal(foldDiacritics("Grossmünster"), "Grossmunster");
});

test("a real landmark passes containment, an unrelated hit does not", () => {
  assert.equal(passesContainment("Colosseum", "Colosseum & Roman Forum (Skip-the-Line Tour)"), true);
  assert.equal(passesContainment("Kyoto Station", "Lunch at Kyoto Station area"), true);
  // The failure this check exists to stop: a generic phrase whose top hit is a real article
  // about something else entirely.
  assert.equal(passesContainment("Lunch", "Lunch in Altstadt neighborhood"), true);
  assert.equal(passesContainment("Швейцария", "Lunch in Altstadt neighborhood"), false);
});

test("a parenthetical suffix is stripped from the title before comparing", () => {
  assert.equal(passesContainment("Uetliberg (mountain)", "Uetliberg summit exploration"), true);
});

test("candidates narrow from the full name down to the landmark", () => {
  assert.deepEqual(candidateQueries("Colosseum & Roman Forum (Skip-the-Line Tour)"), [
    "Colosseum & Roman Forum (Skip-the-Line Tour)",
    "Colosseum & Roman Forum",
    "Colosseum",
  ]);
});

test("a plain name yields exactly one candidate", () => {
  assert.deepEqual(candidateQueries("Kunsthaus Zurich"), ["Kunsthaus Zurich"]);
});

const ORIG = "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b3/I_cipressi.jpg/3840px-I_cipressi.jpg?utm_source=en.wikipedia.org";

test("wideImage steps the 3840px original down to 1280px, keeping the rest of the URL", () => {
  assert.equal(
    wideImage({ originalimage: { source: ORIG } }),
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b3/I_cipressi.jpg/1280px-I_cipressi.jpg?utm_source=en.wikipedia.org"
  );
  assert.equal(wideImage({ originalimage: { source: "https://x/thumb/a/ab/F.svg/2000px-F.svg.png" } }), "https://x/thumb/a/ab/F.svg/1280px-F.svg.png");
});

test("wideImage never upscales or guesses: small renditions and plain URLs pass through", () => {
  const small = "https://x/thumb/a/ab/F.jpg/960px-F.jpg";
  assert.equal(wideImage({ originalimage: { source: small } }), small);
  const plain = "https://upload.wikimedia.org/wikipedia/commons/a/ab/F.jpg";
  assert.equal(wideImage({ originalimage: { source: plain } }), plain);
  assert.equal(wideImage({ originalimage: { source: "https://elsewhere.org/p.jpg" } }), "https://elsewhere.org/p.jpg");
});

test("wideImage falls back to the thumbnail, then null", () => {
  assert.equal(wideImage({ thumbnail: { source: "https://x/thumb/a/ab/F.jpg/330px-F.jpg" } }), "https://x/thumb/a/ab/F.jpg/330px-F.jpg");
  assert.equal(wideImage({}), null);
});
