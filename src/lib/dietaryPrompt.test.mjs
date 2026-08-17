/* Run: node --test src/lib/dietaryPrompt.test.mjs
 *
 * "Says nothing when there is nothing to say" is the load-bearing case: a traveler with no
 * restrictions must produce a byte-identical prompt to the one this app sent before dietary
 * needs existed. The rest pins that a restriction actually reaches the model, since a
 * silently-dropped allergy is the worst failure this feature can have. */
import assert from "node:assert/strict";
import test from "node:test";
import { formatDietary } from "./dietaryPrompt.ts";

test("returns an empty string when there is nothing to say", () => {
  assert.equal(formatDietary(null), "");
  assert.equal(formatDietary({ tags: [], note: "" }), "");
  assert.equal(formatDietary({ tags: [], note: "   " }), "");
});

test("renders tags alone", () => {
  const out = formatDietary({ tags: ["Vegetarian", "Nut allergy"], note: "" });
  assert.match(out, /Vegetarian, Nut allergy/);
  assert.match(out, /Dietary needs:/);
});

test("renders a note alone", () => {
  const out = formatDietary({ tags: [], note: "no shellfish" });
  assert.match(out, /no shellfish/);
});

test("renders tags and note together", () => {
  const out = formatDietary({ tags: ["Vegan"], note: "no raw onion" });
  assert.match(out, /Vegan/);
  assert.match(out, /no raw onion/);
});

test("tells the model to act on it, not just note it", () => {
  const out = formatDietary({ tags: ["Vegan"], note: "" });
  assert.match(out, /every food stop/i);
});

test("trims surrounding whitespace from the note", () => {
  const out = formatDietary({ tags: [], note: "  no shellfish  " });
  assert.doesNotMatch(out, / {2}no shellfish/);
});

test("tolerates a malformed body shape without throwing", () => {
  assert.equal(formatDietary({ tags: "not-an-array", note: 42 }), "");
});
