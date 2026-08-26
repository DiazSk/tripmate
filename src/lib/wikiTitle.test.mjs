/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/wikiTitle.test.mjs
 *
 * Only the pure half is covered. `resolveTitle` is a network call and belongs to Wikipedia;
 * which candidates we try, and which hits we are willing to believe, are ours. */
import assert from "node:assert/strict";
import test from "node:test";
import { candidateQueries, foldDiacritics, passesContainment } from "./wikiTitle.ts";

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
