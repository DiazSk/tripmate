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

test("a failed generation is an error, whatever else the run had reached", () => {
  // The phone's wait screen stays up on failure; the web band never passes `failed`.
  assert.equal(meriForGeneration({ complete: false, streaming: true, failed: true }), "error");
  assert.equal(meriForGeneration({ complete: true, streaming: true, failed: true }), "error");
});

test("a pending reply outranks one that just landed", () => {
  assert.equal(meriForChat({ replying: true, failure: null, justReplied: true }), "thinking");
});

test("the moved motion table still stills everything under reduced motion", () => {
  assert.deepEqual(meridianMotion("speaking", true), {
    breatheMs: null, blink: false, driftMs: null, squash: false, lift: false, eyes: 1,
    glance: null, squint: false, bob: false,
  });
  assert.equal(meridianMotion("paused", true).eyes, 0.8);
});

test("idle glances around and floats, thinking glances up, success squints", () => {
  assert.equal(meridianMotion("idle", false).glance, "around");
  assert.equal(meridianMotion("thinking", false).glance, "up");
  assert.equal(meridianMotion("idle", false).bob, true);
  assert.equal(meridianMotion("success", false).squint, true);
  // Glance and drift share the eyes' wrapper; lift and bob share the body's. Never both at once.
  for (const s of ["idle", "thinking", "streaming", "speaking", "paused", "success", "error", "offline"]) {
    const m = meridianMotion(s, false);
    assert.ok(!(m.glance && m.driftMs), `${s}: glance and drift`);
    assert.ok(!(m.lift && m.bob), `${s}: lift and bob`);
  }
});

test("the blink cycle is the same for the same seed, so server and client agree", () => {
  assert.equal(blinkCycleMs("_R_1_"), blinkCycleMs("_R_1_"));
});

test("the blink cycle stays within 2.8 to 5 seconds and varies by seed", () => {
  // React 19.2 emits ids like `_R_1kl_`; the hash only needs a stable string.
  const seeds = ["_R_1_", "_R_2_", "_R_3_", "_R_4_", "_R_5_", "_r_1kl_"];
  const cycles = seeds.map(blinkCycleMs);
  for (const ms of cycles) {
    assert.ok(Number.isInteger(ms) && ms >= 2800 && ms < 5000, String(ms));
  }
  assert.ok(new Set(cycles).size > 1, "every Meri would blink in step");
});
