/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/storyVoiceQueue.test.mjs
 *
 * The sentence queue behind Story mode, against a fake `speechSynthesis`: a beat picked up at a
 * sentence, the sentence events the subtitle follows, the silent speaker a mute hands the beat to,
 * and one `onEnd` per beat. Its own file because it installs a `window`, which `storyVoice.test.mjs`
 * asserts is absent. */
import test from "node:test";
import assert from "node:assert/strict";

import { LEAD_IN_MS, resumePoint, sentenceTimings, splitForSpeech } from "./storyPacing.ts";
import { setNarrationVolume, speak, speakOn, speakSilently } from "./storyVoice.ts";

const BEAT = "The castle stands above Alfama. Walk the walls slowly. Then come down for lunch.";

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}
const synth = { spoken: [], cancels: 0, speak(u) { this.spoken.push(u); }, cancel() { this.cancels++; }, getVoices: () => [] };
globalThis.window = { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance };
globalThis.SpeechSynthesisUtterance = FakeUtterance;

function reset(t) {
  synth.spoken = [];
  synth.cancels = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
}

/** Say every queued utterance through to its end, as a working voice would. */
function playThrough(t) {
  for (let guard = 0; guard < 20; guard++) {
    const u = synth.spoken.find((x) => !x.played);
    if (!u) return;
    u.played = true;
    u.onstart?.();
    u.onend?.();
    t.mock.timers.tick(1000); // the pause after it, then the next sentence goes out
  }
}

test("a beat picked up at sentence N speaks from N, reports each sentence, and ends once", (t) => {
  reset(t);
  const chunks = splitForSpeech(BEAT);
  const heard = [];
  let ends = 0;
  speak(BEAT, { onEnd: () => ends++, onSentence: (i) => heard.push(i) }, 1);
  t.mock.timers.tick(LEAD_IN_MS);
  assert.equal(synth.spoken[0].text, chunks[1], "the first utterance is sentence 1, not the beat's top");
  playThrough(t);
  assert.deepEqual(synth.spoken.map((u) => u.text), chunks.slice(1));
  assert.deepEqual(heard, [1, 2]);
  assert.equal(ends, 1);
  // The closing sentence still lands slower: pacing reads the absolute index.
  assert.ok(synth.spoken.at(-1).rate < synth.spoken[0].rate);
});

test("a sentence is reported when the voice starts it, not when it is queued", (t) => {
  reset(t);
  const heard = [];
  speak(BEAT, { onSentence: (i) => heard.push(i) });
  t.mock.timers.tick(LEAD_IN_MS);
  assert.equal(synth.spoken.length, 1);
  assert.deepEqual(heard, [], "queued is not heard");
  synth.spoken[0].onstart();
  assert.deepEqual(heard, [0]);
});

test("a cancelled beat never calls back, even when the engine fires onend anyway", (t) => {
  reset(t);
  let calls = 0;
  const handle = speak(BEAT, { onEnd: () => calls++, onError: () => calls++, onSentence: () => calls++ });
  t.mock.timers.tick(LEAD_IN_MS);
  handle.cancel();
  // WebKit fires onend for a cancelled utterance; the done latch must swallow it.
  synth.spoken[0].onstart();
  synth.spoken[0].onend();
  t.mock.timers.tick(60_000);
  assert.equal(calls, 0);
});

test("the start guard still applies to the first sentence spoken when resuming mid-beat", (t) => {
  reset(t);
  let errors = 0;
  speak(BEAT, { onError: () => errors++ }, 2);
  t.mock.timers.tick(LEAD_IN_MS);
  t.mock.timers.tick(2000);
  assert.equal(errors, 1, "a voice that never starts is reported, wherever the beat began");
});

test("speakOn without a loaded natural voice is the platform voice, from the same sentence", (t) => {
  reset(t);
  speakOn("natural", BEAT, {}, 2);
  t.mock.timers.tick(LEAD_IN_MS);
  assert.equal(synth.spoken[0].text, splitForSpeech(BEAT)[2]);
});

test("the silent speaker paces sentences on the estimate, ends once, and never touches the voice", (t) => {
  reset(t);
  const { startMs, totalMs } = sentenceTimings(BEAT);
  const heard = [];
  let ends = 0;
  speakSilently(BEAT, { onEnd: () => ends++, onSentence: (i) => heard.push(i) }, 1);
  // Resuming at sentence 1 starts it after the lead-in, as the voice would.
  t.mock.timers.tick(LEAD_IN_MS);
  assert.deepEqual(heard, [1]);
  t.mock.timers.tick(startMs[2] - startMs[1]);
  assert.deepEqual(heard, [1, 2]);
  t.mock.timers.tick(totalMs);
  assert.equal(ends, 1);
  assert.equal(synth.spoken.length, 0, "a muted beat speaks nothing");
});

test("a mute continues mid-sentence: no lead-in, and the sentence keeps its place", (t) => {
  reset(t);
  const { startMs } = sentenceTimings(BEAT);
  const heard = [];
  speakSilently(BEAT, { onSentence: (i) => heard.push(i) }, 0, 500);
  t.mock.timers.tick(0);
  assert.deepEqual(heard, [0], "the sentence in progress is reported at once");
  // The next sentence arrives 500ms sooner than it would from the sentence's top.
  t.mock.timers.tick(startMs[1] - startMs[0] - 500);
  assert.deepEqual(heard, [0, 1]);
});

test("changing the volume, mute included, speaks and cancels nothing", (t) => {
  reset(t);
  setNarrationVolume(0);
  setNarrationVolume(0.6);
  assert.equal(synth.spoken.length, 0);
  assert.equal(synth.cancels, 0);
  setNarrationVolume(1);
});

/* --- resuming mid-sentence ---
 *
 * A pause used to re-speak the sentence from its first word, and most beats are one or two long
 * sentences, so to the ear the beat started over. */

const LONG = "You wake in the heart of the valley with warm sun already on the stone walls and the cypress lines below the house. Today is about arrival.";

test("a resume picks the sentence up one word before the word it was paused on", (t) => {
  reset(t);
  const { spokenMs } = sentenceTimings(LONG);
  const words = splitForSpeech(LONG)[0].split(" ");
  const halfway = spokenMs[0] / 2;
  const at = resumePoint(LONG, 0, halfway);
  assert.equal(at.words, Math.round(words.length / 2) - 1);
  let heard = null;
  speak(LONG, { onSentence: (i, startedAt) => (heard = { i, startedAt }) }, 0, halfway);
  t.mock.timers.tick(LEAD_IN_MS);
  assert.equal(synth.spoken[0].text, words.slice(at.words).join(" "), "the utterance is the rest of the sentence");
  const before = performance.now();
  synth.spoken[0].onstart();
  assert.equal(heard.i, 0);
  // Reported as started `at.ms` ago, so the caption keeps the words already said lit.
  assert.ok(Math.abs(before - heard.startedAt - at.ms) < 50);
});

test("a resume never skips a whole sentence, and nothing held means from the top", () => {
  const { spokenMs } = sentenceTimings(LONG);
  const count = splitForSpeech(LONG)[0].split(" ").length;
  assert.equal(resumePoint(LONG, 0, spokenMs[0] * 5).words, count - 1, "the last word is still said");
  assert.deepEqual(resumePoint(LONG, 0, 0), { words: 0, ms: 0 });
  assert.deepEqual(resumePoint(LONG, 0, NaN), { words: 0, ms: 0 });
  assert.deepEqual(resumePoint(LONG, 9, 1000), { words: 0, ms: 0 });
});

test("the sentences after a resumed one are spoken whole", (t) => {
  reset(t);
  const chunks = splitForSpeech(LONG);
  speak(LONG, {}, 0, 2000);
  t.mock.timers.tick(LEAD_IN_MS);
  playThrough(t);
  assert.equal(synth.spoken.at(-1).text, chunks[1]);
});
