/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/storyPacing.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as pacing from "./storyPacing.ts";
import * as voice from "./storyVoice.ts";

test("the pacing helpers are one implementation, re-exported by the web voice", () => {
  // Two copies would drift: the phone and the browser must pause in the same places.
  for (const name of ["splitForSpeech", "pauseAfter", "rateFor", "estimateDurationMs"]) {
    assert.equal(voice[name], pacing[name], name);
  }
});

test("the pacing module pulls in no browser voice, so the Expo app can import it", () => {
  const source = readFileSync(new URL("./storyPacing.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imports, ["./storyScript"]);
});

test("a beat is spoken as sentences with the arrival pause after the first", () => {
  const chunks = pacing.splitForSpeech("Here is the castle. It is old. Go now.");
  assert.deepEqual(chunks, ["Here is the castle.", "It is old.", "Go now."]);
  assert.equal(pacing.pauseAfter(chunks[0], 0, 3), 700);
  assert.equal(pacing.pauseAfter(chunks[1], 1, 3), 420);
  assert.equal(pacing.rateFor(2, 3), 0.88);
});

test("novelty voices are exported for the phone's narrator to refuse", () => {
  assert.ok(pacing.NOVELTY_VOICES.includes("bad news"));
});
