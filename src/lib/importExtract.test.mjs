/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/importExtract.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { buildExtractPrompt, parseExtraction } from "./importExtract.ts";

test("the prompt labels every item and says which images are which", () => {
  const p = buildExtractPrompt(
    [{ index: 1, kind: "tiktok", text: "Best ramen: Ichiran" }, { index: 2, kind: "text", text: "Nishiki!" }],
    [0, 3],
    "Kyoto"
  );
  assert.match(p, /Item 1 \(tiktok\): Best ramen: Ichiran/);
  assert.match(p, /Item 2 \(text\): Nishiki!/);
  assert.match(p, /attached images are, in order, items 0, 3/);
  assert.match(p, /Kyoto/);
  assert.match(p, /never guess/i);
});

test("parseExtraction keeps high-confidence places, dedupes by key, drops junk", () => {
  const raw = "```json\n" + JSON.stringify({
    destinationGuess: "Tokyo",
    places: [
      { name: "teamLab Planets", cityHint: "Tokyo", sourceIndex: 0, confidence: "high" },
      { name: "TeamLab planets", cityHint: "Tokyo", sourceIndex: 2, confidence: "high" },
      { name: "Some café maybe", cityHint: null, sourceIndex: 1, confidence: "low" },
      { name: "", sourceIndex: 1, confidence: "high" },
      { name: "No index", confidence: "high" },
    ],
  }) + "\n```";
  assert.deepEqual(parseExtraction(raw), {
    destinationGuess: "Tokyo",
    places: [{ name: "teamLab Planets", cityHint: "Tokyo", sourceIndex: 0 }],
  });
});

test("parseExtraction returns null on malformed output, never throws", () => {
  assert.equal(parseExtraction("I found some places!"), null);
  assert.equal(parseExtraction(JSON.stringify({ places: "nope" })), null);
});
