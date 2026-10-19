import { test } from "node:test";
import assert from "node:assert/strict";

import { beatAt, beatDurations, beatTicks, clockLabel, elapsedMs, subtitleAt } from "./storyTimeline.ts";

const d = [4000, 6000, 10000];

test("elapsed is the beats before plus the time into this one, clamped to its length", () => {
  assert.equal(elapsedMs(d, 0, 0), 0);
  assert.equal(elapsedMs(d, 1, 2500), 6500);
  assert.equal(elapsedMs(d, 1, 99999), 10000);
  assert.equal(elapsedMs(d, 2, 0, true), 20000);
  assert.equal(elapsedMs(d, 3, 0), 20000);
});

test("a point on the bar lands on the beat it falls in", () => {
  assert.equal(beatAt(d, 0), 0);
  assert.equal(beatAt(d, 0.19), 0);
  assert.equal(beatAt(d, 0.2), 1);
  assert.equal(beatAt(d, 0.75), 2);
  assert.equal(beatAt(d, 1), 2);
  assert.equal(beatAt(d, -1), 0);
  assert.equal(beatAt([], 0.5), 0);
});

test("ticks mark where each later beat starts", () => {
  assert.deepEqual(beatTicks(d), [0.2, 0.5]);
  assert.deepEqual(beatTicks([]), []);
});

test("durations come from the narration's own estimate, and the clock reads m:ss", () => {
  const [short, long] = beatDurations([{ text: "Belém." }, { text: "A long sentence about the tower, the river, the light on the water, and the tide coming in under it all afternoon." }]);
  assert.ok(long > short);
  assert.equal(clockLabel(67_400), "1:07");
  assert.equal(clockLabel(0), "0:00");
});

test("a subtitle is the sentence the voice reports, its words lit across that sentence", () => {
  const text = "The castle stands above Alfama. Walk the walls while the morning holds dry, then come down slowly.";
  const start = subtitleAt(text, 0, 0);
  assert.equal(start.index, 0);
  assert.equal(start.count, 2);
  assert.equal(start.sentence, "The castle stands above Alfama.");
  assert.equal(start.said, 0);
  // However long the beat has run, the caption stays on the sentence the voice is on: a voice that
  // is late (or still downloading) holds the line fully lit, it never jumps ahead to sentence two.
  const late = subtitleAt(text, 0, 60_000);
  assert.equal(late.index, 0);
  assert.equal(late.said, late.words.length);
  // And the scrubber stops at the next sentence's start rather than running past it.
  const second = subtitleAt(text, 1, 0);
  assert.equal(second.index, 1);
  assert.equal(second.said, 0);
  assert.equal(late.withinMs, second.withinMs);
  assert.ok(subtitleAt(text, 1, 1000).withinMs > second.withinMs);
  assert.equal(subtitleAt(text, 9, 0).index, 1);
  assert.deepEqual(subtitleAt("", 0, 500), { sentence: "", words: [], said: 0, index: 0, count: 0, withinMs: 0 });
});
