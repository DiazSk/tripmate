/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/meri.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { blinkCycleMs, meriForChat, meriForGeneration, meriForStory, meridianMotion } from "./meri.ts";

const story = (s) => ({ phase: "playing", voiceBroken: false, muted: false, silentPlatform: false, ...s });

test("the module imports nothing, so the Expo bundle can reach it", () => {
  const source = readFileSync(new URL("./meri.ts", import.meta.url), "utf8");
  assert.equal(/^\s*import\s/m.test(source), false);
});

test("the story speaks while playing aloud", () => {
  assert.equal(meriForStory(story({})), "speaking");
});

test("the story thinks while the script is being written", () => {
  assert.equal(meriForStory(story({ phase: "loading" })), "thinking");
});

test("a paused story rests", () => {
  assert.equal(meriForStory(story({ phase: "paused" })), "paused");
});

test("muted or speechless, Meri breathes instead of acting out speech", () => {
  assert.equal(meriForStory(story({ muted: true })), "idle");
  assert.equal(meriForStory(story({ silentPlatform: true })), "idle");
});

test("a voice that proved mute is an error, even though it also reads as silent", () => {
  assert.equal(meriForStory(story({ voiceBroken: true, silentPlatform: true })), "error");
  assert.equal(meriForStory(story({ phase: "paused", voiceBroken: true, silentPlatform: true })), "error");
});

test("the end of a day is a success even if the voice failed on the way", () => {
  assert.equal(meriForStory(story({ phase: "ended", voiceBroken: true, silentPlatform: true })), "success");
});

test("the generation run thinks, then streams once stops draw, then succeeds", () => {
  assert.equal(meriForGeneration({ complete: false, streaming: false }), "thinking");
  assert.equal(meriForGeneration({ complete: false, streaming: true }), "streaming");
  assert.equal(meriForGeneration({ complete: true, streaming: true }), "success");
});

test("a pending reply outranks one that just landed", () => {
  assert.equal(meriForChat({ replying: true, failure: null, justReplied: true }), "thinking");
});

test("the moved motion table still stills everything under reduced motion", () => {
  assert.deepEqual(meridianMotion("speaking", true), {
    breatheMs: null, blink: false, driftMs: null, squash: false, lift: false, eyes: 1,
  });
  assert.equal(meridianMotion("paused", true).eyes, 0.8);
});

test("the blink cycle is the same for the same seed, so server and client agree", () => {
  assert.equal(blinkCycleMs("«r1»"), blinkCycleMs("«r1»"));
});

test("the blink cycle stays within 2.8 to 5 seconds and varies by seed", () => {
  const seeds = ["«r1»", "«r2»", "«r3»", "«r4»", "«r5»", ":R1:"];
  const cycles = seeds.map(blinkCycleMs);
  for (const ms of cycles) {
    assert.ok(Number.isInteger(ms) && ms >= 2800 && ms < 5000, String(ms));
  }
  assert.ok(new Set(cycles).size > 1, "every Meri would blink in step");
});
