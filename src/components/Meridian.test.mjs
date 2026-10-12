/* Run: node --test src/components/Meridian.test.mjs
   Nothing renders in this suite, so these hold the two structural decisions by reading the source. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

test("the eye animations ride HTML boxes, not SVG groups, so the browser can composite them", () => {
  // WebKit only accelerates animations on elements with their own layer, and SVG children never get
  // one — a blink on a <g> is main-thread style and paint every frame, inside a backdrop-filter panel.
  const src = read("Meridian.tsx");
  assert.equal(/<g\b[^>]*meri-(blink|drift)/.test(src), false);
  assert.match(src, /<span[^>]*meri-blink/);
  assert.match(src, /<span[^>]*meri-drift/);
});

test("the chat header announces only that TripMate is replying, not its whole header every turn", () => {
  const src = read("EditChatPanel.tsx");
  assert.equal(/<div className="min-w-0" role="status">/.test(src), false);
  assert.match(src, /<p className="sr-only" role="status">\s*\{busy \? "TripMate is replying" : ""\}/);
});
