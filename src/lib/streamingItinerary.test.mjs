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
