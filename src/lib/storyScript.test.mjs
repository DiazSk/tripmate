/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/storyScript.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";

import {
  beatOpacity,
  buildStoryPrompt,
  compactDay,
  fallbackScript,
  normaliseScript,
  storyCacheKey,
} from "./storyScript.ts";

const stop = (name, extra = {}) => ({
  name,
  lat: 1,
  lng: 2,
  cost: 10,
  note: `note for ${name}`,
  time: "9:00 AM",
  durationLabel: "1 hour",
  category: "other",
  ...extra,
});

const day = (stops, extra = {}) => ({
  date: "2026-09-19",
  weather: "Clear, 24°C",
  stops,
  ...extra,
});

const params = (d, dayIndex = 0) => ({
  day: d,
  dayIndex,
  dayCount: 3,
  destination: "Lisbon, Portugal",
});

test("compactDay carries every field the narration can see, and nothing it can't", () => {
  const text = compactDay(
    day([stop("Belém Tower", { why: "you asked for waterfront history" })], {
      title: "Arrival day",
      summary: "Slow start, river light",
      lodging: { name: "Casa Amarela", cost: 90, note: "walkable to the tram", actualCost: 120 },
    }),
    2
  );
  assert.match(text, /Day 3 — 2026-09-19 — Arrival day/);
  assert.match(text, /Day theme: Slow start, river light/);
  assert.match(text, /Staying at: Casa Amarela — walkable to the tram/);
  assert.match(text, /Stop 0: Belém Tower, at 9:00 AM, for 1 hour, \(other\)/);
  assert.match(text, /Why it suits them: you asked for waterfront history/);
  // actualCost moves after the trip is over, so it must not invalidate a cached script.
  assert.doesNotMatch(text, /120/);
});

/* The session cache in storyMode.tsx dedupes every request for a day's narration against this
 * string — including a background warm and the Play press that follows it, which must be one call
 * and not two. It used to be built from a hand-picked list of stop fields, and drifted from what
 * the prompt actually reads. These are the claims that keep the two together; `compactDay`'s own
 * field coverage is asserted above, so what is new here is that the key is built from it, plus the
 * three inputs that live outside it. */
test("the session cache key changes exactly when the narration would", () => {
  const base = params(day([stop("Belém Tower", { why: "waterfront history" })]));
  const same = params(day([stop("Belém Tower", { why: "waterfront history" })]));
  assert.equal(storyCacheKey(base), storyCacheKey(same));

  // No trip id in it, which is the point: the three Play call sites send a real id, the "preview"
  // placeholder and nothing at all, and all three must reach one entry.
  assert.equal(storyCacheKey({ ...base, tripId: "abc" }), storyCacheKey({ ...base, tripId: "xyz" }));

  // Everything the narrator reads is in the key.
  assert.notEqual(
    storyCacheKey(base),
    storyCacheKey(params(day([stop("Belém Tower", { why: "somewhere quiet instead" })])))
  );
  assert.notEqual(
    storyCacheKey(base),
    storyCacheKey(params(day([stop("Belém Tower", { why: "waterfront history" })], { weather: "Rain, 12°C" })))
  );
  assert.notEqual(storyCacheKey(base), storyCacheKey({ ...base, destination: "Porto, Portugal" }));
  assert.notEqual(storyCacheKey(base), storyCacheKey({ ...base, dayCount: 9 }));
  assert.notEqual(storyCacheKey(base), storyCacheKey({ ...base, dayIndex: 2 }));

  // And nothing it doesn't: a lodging's actualCost moves after the trip, with nobody watching.
  const cheap = day([stop("Belém Tower", { why: "waterfront history" })], {
    lodging: { name: "Casa Amarela", cost: 90, actualCost: 120 },
  });
  const dear = day([stop("Belém Tower", { why: "waterfront history" })], {
    lodging: { name: "Casa Amarela", cost: 90, actualCost: 400 },
  });
  assert.equal(storyCacheKey(params(cheap)), storyCacheKey(params(dear)));
});

test("the prompt asks for one beat per stop plus an opening and a closing", () => {
  const prompt = buildStoryPrompt({
    destination: "Lisbon, Portugal",
    dayIndex: 1,
    dayCount: 4,
    day: day([stop("A"), stop("B"), stop("C")]),
  });
  assert.match(prompt, /Exactly 5 beats/);
  assert.match(prompt, /one "stop" beat for each of the 3 stops/);
  assert.match(prompt, /0 to 2/);
  // The facts arrive through compactDay and the ask carries no planning rules.
  assert.match(prompt, /Stop 1: B/);
  assert.doesNotMatch(prompt, /budget/i);
});

test("a well-formed script is accepted in the day's own order", () => {
  const d = day([stop("A"), stop("B")]);
  const script = normaliseScript(
    {
      beats: [
        { kind: "stop", stopIndex: 1, text: "Second." },
        { kind: "opening", text: "  The   morning  begins.  " },
        { kind: "stop", stopIndex: 0, text: "First." },
        { kind: "closing", text: "And that is the day." },
      ],
    },
    params(d)
  );
  assert.deepEqual(
    script.beats.map((b) => [b.kind, b.stopIndex ?? null, b.text]),
    [
      ["opening", null, "The morning begins."],
      ["stop", 0, "First."],
      ["stop", 1, "Second."],
      ["closing", null, "And that is the day."],
    ]
  );
  assert.equal(script.source, "model");
});

test("a skipped stop is filled from the day rather than leaving a row that never lights", () => {
  const d = day([stop("A", { why: "why A" }), stop("B"), stop("C")]);
  const script = normaliseScript(
    { beats: [{ kind: "stop", stopIndex: 0, text: "Only the first." }] },
    params(d)
  );
  // opening + one per stop; a missing closing is dropped rather than invented.
  assert.equal(script.beats.length, 4);
  assert.deepEqual(
    script.beats.map((b) => b.kind),
    ["opening", "stop", "stop", "stop"]
  );
  assert.deepEqual(
    script.beats.map((b) => b.stopIndex),
    [undefined, 0, 1, 2]
  );
  assert.match(script.beats[2].text, /B/);
  assert.ok(script.beats.every((b) => b.text.trim().length > 0));
});

test("junk cannot produce an unplayable script", () => {
  const d = day([stop("A")]);
  for (const raw of [null, undefined, "nope", {}, { beats: "no" }, { beats: [{}, { text: "" }] }]) {
    const script = normaliseScript(raw, params(d));
    assert.equal(script.beats.length, 2, `beats for ${JSON.stringify(raw)}`);
    assert.ok(script.beats.every((b) => b.text.length > 0));
  }
});

test("out-of-range and duplicate stopIndexes are ignored, first match winning", () => {
  const d = day([stop("A"), stop("B")]);
  const script = normaliseScript(
    {
      beats: [
        { kind: "stop", stopIndex: 7, text: "A stop that does not exist." },
        { kind: "stop", stopIndex: 0, text: "The real first." },
        { kind: "stop", stopIndex: 0, text: "A second try at the first." },
        { kind: "stop", stopIndex: "1", text: "A string index." },
      ],
    },
    params(d)
  );
  assert.equal(script.beats.length, 3);
  assert.equal(script.beats[1].text, "The real first.");
  // stopIndex "1" is not 1 — that beat is dropped and stop B falls back to its own fields.
  assert.match(script.beats[2].text, /note for B/);
  assert.doesNotMatch(script.beats.map((b) => b.text).join(" "), /does not exist|string index/);
});

test("the fallback script is the day read aloud, and says so", () => {
  const d = day([stop("A", { why: "why A" }), stop("B")], { summary: "A river day" });
  const script = fallbackScript(params(d, 1));
  assert.equal(script.source, "fallback");
  assert.equal(script.dayIndex, 1);
  assert.equal(script.beats.length, 3);
  assert.match(script.beats[0].text, /Day 2 of 3 in Lisbon\./);
  assert.match(script.beats[0].text, /A river day\./);
  assert.match(script.beats[1].text, /9:00 AM\. A\. why A\. note for A\./);
});

test("an empty day still yields a playable opening", () => {
  const script = fallbackScript(params(day([])));
  assert.equal(script.beats.length, 1);
  assert.ok(script.beats[0].text.length > 0);
});

test("the lyric ramp puts the spoken line first and fades behind faster than ahead", () => {
  assert.equal(beatOpacity(3, 3), 1);
  assert.ok(beatOpacity(4, 3) > beatOpacity(5, 3));
  assert.ok(beatOpacity(5, 3) > beatOpacity(9, 3));
  // A line already heard has less claim on the eye than one about to be.
  assert.ok(beatOpacity(2, 3) < beatOpacity(4, 3));
  assert.ok(beatOpacity(0, 3) < beatOpacity(2, 3));
});
