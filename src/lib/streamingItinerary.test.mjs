/* Run: node --test src/lib/streamingItinerary.test.mjs
 *
 * The parser reads a model's JSON while it is still being written, so it never sees a
 * whole document — it sees whatever arrived since the last token. The bug class that
 * matters is a chunk boundary landing inside a field, which every test written against
 * one big feed() will miss. The exhaustive-split test below is the one that catches it. */
import assert from "node:assert/strict";
import test from "node:test";
import { StreamingItineraryParser } from "./streamingItinerary.ts";

const STOP_A =
  '{"name":"Fushimi Inari","lat":34.96,"lng":135.77,"cost":0,"why":"w1","note":"n1",' +
  '"time":"9:00 AM","durationLabel":"2 hours","category":"other"}';
const STOP_B =
  '{"name":"Nishiki Market","lat":35.00,"lng":135.76,"cost":20,"why":"w2","note":"n2",' +
  '"time":"1:00 PM","durationLabel":"1 hour","category":"food"}';
const DAY_1 =
  '{"date":"2026-05-01","weather":"clear","summary":"s1",' +
  `"lodging":{"name":"Hotel","cost":100,"note":"ln"},"stops":[${STOP_A},${STOP_B}]}`;
const DAY_2 =
  '{"date":"2026-05-02","weather":"rain","summary":"s2","stops":[' + STOP_A + "]}";
const FULL = `{"days":[${DAY_1},${DAY_2}]}`;

/** Feeds `text` in chunks and returns every stop and closed-day report, in order. */
function drain(chunks) {
  const parser = new StreamingItineraryParser();
  const stops = [];
  const closedDays = [];
  for (const chunk of chunks) {
    const result = parser.feed(chunk);
    stops.push(...result.stops);
    closedDays.push(...result.closedDays);
  }
  return { stops, closedDays };
}

test("a complete response yields every stop once, in order", () => {
  const { stops, closedDays } = drain([FULL]);
  assert.deepEqual(
    stops.map((s) => [s.dayIndex, s.stopIndex, s.stop.name]),
    [
      [0, 0, "Fushimi Inari"],
      [0, 1, "Nishiki Market"],
      [1, 0, "Fushimi Inari"],
    ]
  );
  assert.deepEqual(closedDays, [0, 1]);
});

test("feeding one character at a time yields the identical sequence", () => {
  const whole = drain([FULL]);
  const perChar = drain([...FULL]);
  assert.deepEqual(perChar.stops, whole.stops);
  assert.deepEqual(perChar.closedDays, whole.closedDays);
});

test("every possible two-way split yields the identical sequence", () => {
  const whole = drain([FULL]);
  for (let i = 1; i < FULL.length; i++) {
    const split = drain([FULL.slice(0, i), FULL.slice(i)]);
    assert.deepEqual(split.stops, whole.stops, `split at ${i} changed the stops`);
    assert.deepEqual(split.closedDays, whole.closedDays, `split at ${i} changed the days`);
  }
});

test("a stop is withheld until its category arrives", () => {
  const partial = `{"days":[{"date":"2026-05-01","weather":"clear","stops":[` + STOP_A.slice(0, STOP_A.indexOf('"category"'));
  const { stops } = drain([partial]);
  assert.deepEqual(stops, []);
});

test("a day is reported closed only when its object closes", () => {
  const parser = new StreamingItineraryParser();
  const open = parser.feed(`{"days":[${DAY_1.slice(0, -1)}`);
  assert.deepEqual(open.closedDays, []);
  const closed = parser.feed("}");
  assert.deepEqual(closed.closedDays, [0]);
});

test("a leading markdown fence does not break the parse", () => {
  const { stops } = drain(["```json\n" + FULL + "\n```"]);
  assert.equal(stops.length, 3);
});

test("a stop is never emitted twice across feeds", () => {
  const parser = new StreamingItineraryParser();
  const seen = [];
  for (const ch of FULL) seen.push(...parser.feed(ch).stops);
  const keys = seen.map((s) => `${s.dayIndex}:${s.stopIndex}`);
  assert.deepEqual(keys, [...new Set(keys)]);
});

test("garbage in yields nothing rather than throwing", () => {
  const parser = new StreamingItineraryParser();
  assert.deepEqual(parser.feed("not json at all }}}").stops, []);
});

/* `date` rides along on every stop because a `stop` frame is all the client gets before the
 * day closes — see StreamedStop. The exhaustive-split test above already proves it survives a
 * chunk boundary (it deep-equals whole stop objects); these two pin the value itself. */
test("each stop carries its own day's date", () => {
  const { stops } = drain([FULL]);
  assert.deepEqual(
    stops.map((s) => s.date),
    ["2026-05-01", "2026-05-01", "2026-05-02"]
  );
});

test("a day with no date reports an empty string, not undefined", () => {
  const { stops } = drain([`{"days":[{"weather":"clear","stops":[${STOP_A}]}]}`]);
  assert.equal(stops[0].date, "");
});

/* The invariant that lets `isRenderableStop` be cheap: `category` is the LAST field of the shape
 * `itineraryPrompt.ts` asks for, so an object carrying one carries all of them.
 *
 * These guard the moment that stops being true. `timeFlexibility` and `outdoor` were added to the
 * stop shape, and were put IN FRONT of `category` for exactly this reason — appended after it,
 * every stop would reach the generation screen before its last two fields arrived, with nothing
 * thrown and nothing logged. A test is the only thing that can notice. */
const STOP_WITH_FLAGS =
  '{"name":"Nijo Castle","lat":35.01,"lng":135.74,"cost":15,"why":"w3","note":"n3",' +
  '"time":"10:00 AM","durationLabel":"90 minutes","outdoor":true,"timeFlexibility":"FIXED",' +
  '"category":"entry"}';

test("the new stop flags arrive with the stop rather than after it", () => {
  const { stops } = drain([`{"days":[{"date":"2026-05-01","weather":"clear","stops":[${STOP_WITH_FLAGS}]}]}`]);
  assert.equal(stops.length, 1);
  assert.equal(stops[0].stop.outdoor, true);
  assert.equal(stops[0].stop.timeFlexibility, "FIXED");
});

test("a stop is withheld until category arrives, flags included", () => {
  const upTo = STOP_WITH_FLAGS.indexOf(',"category"');
  const head = `{"days":[{"date":"2026-05-01","weather":"clear","stops":[${STOP_WITH_FLAGS.slice(0, upTo)}`;
  const parser = new StreamingItineraryParser();
  assert.deepEqual(parser.feed(head).stops, [], "everything but category is not yet a stop");
  const { stops } = parser.feed(`${STOP_WITH_FLAGS.slice(upTo)}]}]}`);
  assert.equal(stops.length, 1, "and it lands complete on the chunk that closes it");
  assert.equal(stops[0].stop.outdoor, true);
});

// Every chunk boundary, the way the file's headline test does it: a split inside "timeFlexibility"
// or its value must not produce a half-written stop either.
test("no chunk boundary inside the new fields leaks a partial stop", () => {
  const body = `{"days":[{"date":"2026-05-01","weather":"clear","stops":[${STOP_WITH_FLAGS}]}]}`;
  for (let at = 1; at < body.length; at++) {
    const { stops } = drain([body.slice(0, at), body.slice(at)]);
    assert.equal(stops.length, 1, `split at ${at} yielded ${stops.length} stops`);
    assert.equal(stops[0].stop.timeFlexibility, "FIXED", `split at ${at} lost timeFlexibility`);
  }
});
