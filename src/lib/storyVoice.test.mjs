/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/storyVoice.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateDurationMs,
  pauseAfter,
  pickVoice,
  rateFor,
  speechAvailable,
  splitForSpeech,
} from "./storyVoice.ts";

const voice = (name, lang, localService, isDefault = false) => ({
  name,
  lang,
  localService,
  default: isDefault,
});

test("a local premium English voice wins", () => {
  const chosen = pickVoice([
    voice("Alex", "en-US", true),
    voice("Samantha (Enhanced)", "en-US", true),
    voice("Google UK English Female", "en-GB", false),
  ]);
  assert.equal(chosen.name, "Samantha (Enhanced)");
});

test("locality is the tiebreaker, not the ranking", () => {
  // Two voices of equal name-rank: the local one wins.
  const chosen = pickVoice([voice("Aria", "en-US", false), voice("Aria", "en-US", true)]);
  assert.equal(chosen.localService, true);
});

test("a novelty voice never narrates, however English it is", () => {
  // macOS ships these and Chrome exposes them all. "Bad News" sings the text to a funeral march.
  const chosen = pickVoice([
    voice("Bad News", "en-US", true, true),
    voice("Zarvox", "en-US", true),
    voice("Google UK English Female", "en-GB", false),
  ]);
  assert.equal(chosen.name, "Google UK English Female");
  // With nothing but novelty voices there is no voice at all — the film plays silently rather
  // than being sung to.
  assert.equal(pickVoice([voice("Bells", "en-US", true), voice("Bubbles", "en-US", true)]), null);
});

test("a named good voice outranks a plain local one", () => {
  // The reversal: locality used to dominate, which narrated in Fred on a Mac with no premium
  // voices installed.
  const chosen = pickVoice([
    voice("Fred", "en-US", true, true),
    voice("Google UK English Female", "en-GB", false),
  ]);
  assert.equal(chosen.name, "Google UK English Female");
});

test("an enhanced variant beats the compact voice of the same name", () => {
  const chosen = pickVoice([voice("Samantha", "en-US", true), voice("Samantha (Enhanced)", "en-US", true)]);
  assert.equal(chosen.name, "Samantha (Enhanced)");
});

test("non-English voices are never chosen for an English script", () => {
  assert.equal(pickVoice([voice("Amélie", "fr-CA", true), voice("Yuna", "ko-KR", true)]), null);
  assert.equal(pickVoice([]), null);
  // A plain `en` lang tag counts, and a language that merely starts with the letters does not.
  assert.equal(pickVoice([voice("Plain", "en", true)]).name, "Plain");
  assert.equal(pickVoice([voice("Basque", "eu-ES", true)]), null);
});

test("with nothing preferred present, any usable English voice is still returned", () => {
  // Neither name is on the preferred list; neither is a novelty voice either.
  const chosen = pickVoice([voice("Karen", "en-AU", true), voice("Moira", "en-IE", true)]);
  assert.ok(chosen);
  assert.match(chosen.lang, /^en/);
});

test("beat duration tracks word count, with a floor the camera flight needs", () => {
  // flyTo is a 2.5s flight, so no beat may be shorter than it.
  assert.ok(estimateDurationMs("Go.") >= 3200);
  assert.ok(estimateDurationMs("   ") >= 3200);
  const forty = estimateDurationMs(new Array(40).fill("word").join(" "));
  const eighty = estimateDurationMs(new Array(80).fill("word").join(" "));
  assert.ok(eighty > forty * 1.6, `80 words (${eighty}ms) should roughly double 40 (${forty}ms)`);
  // 160 wpm divided by the 0.92 narration rate, plus the lead-in: forty words is about eighteen
  // seconds of speech. (A single chunk, so no inter-sentence silence is added here.)
  assert.ok(forty > 15_500 && forty < 18_500, `${forty}ms`);
});

test("speechAvailable is false off a browser, so the caller falls back to timed beats", () => {
  assert.equal(speechAvailable(), false);
});

test("a beat is split at sentence boundaries and nowhere else", () => {
  assert.deepEqual(
    splitForSpeech("The bamboo closes over you. The stalks click in the breeze. You keep walking."),
    ["The bamboo closes over you.", "The stalks click in the breeze.", "You keep walking."]
  );
  // Commas are the engine's own pauses — cutting there would lose the sentence's intonation.
  assert.deepEqual(splitForSpeech("You walk up, slowly, past the rest house."), [
    "You walk up, slowly, past the rest house.",
  ]);
});

test("an abbreviation's full stop is not a breath", () => {
  // "St." followed by 420ms of silence is the bug this guards.
  assert.deepEqual(splitForSpeech("You reach St. George's Castle. The city opens below."), [
    "You reach St. George's Castle.",
    "The city opens below.",
  ]);
  assert.equal(splitForSpeech("Take the No. 28 tram up the hill.").length, 1);
});

test("a stray fragment is glued onto the sentence after it", () => {
  // Fallback scripts open with a bare clock time; alone it is a one-word utterance and a hole.
  assert.deepEqual(splitForSpeech("9:00 AM. Morning coffee in Principe Real. Sit outside."), [
    "9:00 AM. Morning coffee in Principe Real.",
    "Sit outside.",
  ]);
});

test("splitting survives the shapes that have no sentences at all", () => {
  assert.deepEqual(splitForSpeech(""), []);
  assert.deepEqual(splitForSpeech("   "), []);
  assert.deepEqual(splitForSpeech("no terminal punctuation here"), ["no terminal punctuation here"]);
  assert.deepEqual(splitForSpeech("Questions? Then answers!"), ["Questions?", "Then answers!"]);
});

test("the arrival pause is the longest, and the last chunk has none", () => {
  const chunks = ["Then the bamboo closes over you.", "The stalks click.", "You keep walking."];
  const gaps = chunks.map((c, i) => pauseAfter(c, i, chunks.length));
  // The camera lands as the beat begins, so the silence after the naming sentence is the longest.
  assert.ok(gaps[0] > gaps[1], `${gaps[0]} should exceed ${gaps[1]}`);
  // The gap between beats belongs to the controller, not to the last sentence.
  assert.equal(gaps[2], 0);
  // A single-sentence beat gets no trailing silence either.
  assert.equal(pauseAfter("One line.", 0, 1), 0);
});

test("punctuation chooses the pause length", () => {
  assert.ok(pauseAfter("It trails off...", 1, 3) > pauseAfter("A plain sentence.", 1, 3));
  assert.ok(pauseAfter("Really!", 1, 3) > pauseAfter("A plain sentence.", 1, 3));
});

test("the final sentence of a beat lands slower", () => {
  assert.ok(rateFor(2, 3) < rateFor(1, 3));
  // A one-sentence beat is not a landing — it keeps the narration rate.
  assert.equal(rateFor(0, 1), rateFor(0, 3));
});

test("the silent estimate includes the silences, so a muted film keeps the pacing", () => {
  const beat = "Then the bamboo closes over you. The stalks click in the breeze. You keep walking.";
  const spoken = estimateDurationMs(beat);
  // Three sentences carry a lead-in plus two real gaps — over a second of deliberate silence that
  // a naive words-per-minute estimate would have skipped.
  const naive = Math.round((beat.split(/\s+/).length / 160) * 60_000);
  assert.ok(spoken > naive + 1200, `${spoken}ms vs naive ${naive}ms`);
});
