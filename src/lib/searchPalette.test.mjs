import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY_COLOURS_HEX,
  MIN_COLOUR_DISTANCE,
  MIN_PIN_CHROMA,
  MIN_PIN_LIGHTNESS,
  SEARCH_COLOURS,
  colourDistance,
  oklab,
  searchColourFor,
} from "./searchPalette.ts";
import { PLACE_CATEGORIES } from "./placeSearch.ts";

const entries = Object.entries(SEARCH_COLOURS);

// --- the two separations this palette exists to guarantee -----------------------------------------

test("no search colour can be mistaken for a day colour", () => {
  const failures = [];
  for (const [category, colour] of entries) {
    for (const day of DAY_COLOURS_HEX) {
      const d = colourDistance(colour, day);
      if (d < MIN_COLOUR_DISTANCE) failures.push(`${category} ${colour} vs day ${day}: ${d.toFixed(3)}`);
    }
  }
  assert.deepEqual(failures, [], `too close to the trip's own colours:\n  ${failures.join("\n  ")}`);
});

test("no two search colours can be mistaken for each other", () => {
  const failures = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const d = colourDistance(entries[i][1], entries[j][1]);
      if (d < MIN_COLOUR_DISTANCE) {
        failures.push(`${entries[i][0]} vs ${entries[j][0]}: ${d.toFixed(3)}`);
      }
    }
  }
  assert.deepEqual(failures, [], `search colours collide:\n  ${failures.join("\n  ")}`);
});

/**
 * The floor that separation alone does not give you.
 *
 * `MIN_COLOUR_DISTANCE` is a *distance*, so a dark navy can sit far from every day colour and every
 * other pin and still be unreadable as a 6px dot on the slated basemap — measured while placing
 * `hotel`: scored on separation alone the best candidate in the whole gamut was `#0000b3`. These
 * bounds are read off the colours that were already here and known to work, so the assertion is
 * "as legible as the set you are joining" rather than a number somebody liked.
 */
test("every category colour is as bright and as vivid as the set it joins", () => {
  const failures = [];
  for (const c of PLACE_CATEGORIES) {
    const [L, a, b] = oklab(SEARCH_COLOURS[c]);
    const chroma = Math.hypot(a, b);
    if (L < MIN_PIN_LIGHTNESS) failures.push(`${c} too dark: L ${L.toFixed(3)}`);
    if (chroma < MIN_PIN_CHROMA) failures.push(`${c} too washed out: C ${chroma.toFixed(3)}`);
  }
  // `place` is deliberately exempt — it is the near-neutral that says "you typed this", and its
  // chroma of 0.007 is the whole point. See the note on it in `SEARCH_COLOURS`.
  assert.deepEqual(failures, [], `unreadable on a dark basemap:\n  ${failures.join("\n  ")}`);
});

// --- completeness ----------------------------------------------------------------------------------

test("every category the picker offers has a colour", () => {
  for (const c of PLACE_CATEGORIES) {
    assert.ok(SEARCH_COLOURS[c], `no colour for "${c}" — the picker would draw it as free text`);
  }
});

test("free text has its own colour, distinct from every category", () => {
  assert.ok(SEARCH_COLOURS.place);
  for (const c of PLACE_CATEGORIES) {
    assert.ok(
      colourDistance(SEARCH_COLOURS.place, SEARCH_COLOURS[c]) >= MIN_COLOUR_DISTANCE,
      `free text is indistinguishable from ${c}`
    );
  }
});

test("every colour is a full six-digit hex, which the paint expression requires", () => {
  for (const [category, colour] of entries) {
    assert.match(colour, /^#[0-9a-f]{6}$/, `${category} is not a plain #rrggbb: ${colour}`);
  }
});

// --- the lookup --------------------------------------------------------------------------------------

test("a known category resolves to its own colour", () => {
  assert.equal(searchColourFor("cafe"), SEARCH_COLOURS.cafe);
  assert.equal(searchColourFor("sights"), SEARCH_COLOURS.sights);
});

test("anything a provider invents falls back to free text rather than to undefined", () => {
  // A paint expression handed `undefined` throws and takes the whole layer with it.
  assert.equal(searchColourFor("aquarium"), SEARCH_COLOURS.place);
  assert.equal(searchColourFor(undefined), SEARCH_COLOURS.place);
  assert.equal(searchColourFor(""), SEARCH_COLOURS.place);
});

// --- the colour maths itself --------------------------------------------------------------------------

test("OKLab puts white and black at the ends of L and neutral on a/b", () => {
  const [lWhite, aWhite, bWhite] = oklab("#ffffff");
  const [lBlack] = oklab("#000000");
  assert.ok(Math.abs(lWhite - 1) < 0.01, `white L should be ~1, got ${lWhite}`);
  assert.ok(Math.abs(lBlack) < 0.01, `black L should be ~0, got ${lBlack}`);
  assert.ok(Math.abs(aWhite) < 0.01 && Math.abs(bWhite) < 0.01, "white must be neutral");
});

test("a colour is zero distance from itself, and distance is symmetric", () => {
  assert.equal(colourDistance("#3d9ab8", "#3d9ab8"), 0);
  assert.ok(
    Math.abs(colourDistance("#ffb020", "#22d3ee") - colourDistance("#22d3ee", "#ffb020")) < 1e-12
  );
});

test("the metric is perceptual, not RGB — near-identical greys stay near, vivid hues stay far", () => {
  assert.ok(colourDistance("#808080", "#828282") < 0.02, "two greys a hair apart must read as close");
  assert.ok(colourDistance("#ffb020", "#b36bff") > 0.3, "gold and purple must read as far apart");
});

test("the threshold is above a just-noticeable difference, or it guarantees nothing", () => {
  assert.ok(MIN_COLOUR_DISTANCE > 0.02, "a JND on a flat swatch is nowhere near enough for a 6px dot");
});
