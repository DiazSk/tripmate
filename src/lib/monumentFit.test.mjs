import test from "node:test";
import assert from "node:assert/strict";

import { monumentEms } from "./monumentFit.ts";

// Rendered widths in ems, measured in the browser on the monument itself (Oswald 400, -0.005em).
const RENDERED = { ROME: 2.102, WARSAW: 3.345, LISBON: 2.679 };

test("a name sized from its ems never renders wider than the line it was sized for", () => {
  for (const [word, rendered] of Object.entries(RENDERED)) {
    assert.ok(monumentEms(word) >= rendered, `${word}: ${monumentEms(word)} < ${rendered}`);
  }
});

test("the margin is a margin, not a shrink: a name still fills at least 95% of its line", () => {
  for (const [word, rendered] of Object.entries(RENDERED)) {
    assert.ok(rendered / monumentEms(word) > 0.95, `${word} fills ${rendered / monumentEms(word)}`);
  }
});

test("the flat half-em it replaces under-measured exactly the names that clipped", () => {
  // Rome and Warsaw are wider than half an em a letter; the old size cut their last letter off.
  assert.ok(RENDERED.ROME > 4 * 0.5);
  assert.ok(RENDERED.WARSAW > 6 * 0.5);
  assert.ok(monumentEms("Rome") > 4 * 0.5);
});

test("case and accents do not change the width", () => {
  assert.equal(monumentEms("lisbon"), monumentEms("LISBON"));
  assert.equal(monumentEms("Montréal"), monumentEms("MONTREAL"));
});

test("a very short name stops at the floor rather than towering", () => {
  assert.equal(monumentEms("Ii"), 2);
  assert.equal(monumentEms(""), 2);
});
