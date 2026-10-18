import assert from "node:assert/strict";
import test from "node:test";
import { CAPS, checkItinerary, checkText, readJsonCapped, tooLongResponse } from "./inputLimits.ts";

// Copy table row SV-17 (docs/superpowers/plans/2026-10-17-error-messages-copy.md, section 9).
const SV17 = (n) => `That’s longer than TripMate can read at once. Shorten it to under ${n} characters and send it again.`;

const post = (body) => new Request("http://x/api", { method: "POST", body });
const stop = (extra = {}) => ({ id: "s", name: "Louvre", ...extra });

test("checkText: over the cap is 413 with SV-17, exactly at it is ok, a non-string is ok", () => {
  const over = checkText("x".repeat(2001), 2000);
  assert.deepEqual(over, { ok: false, status: 413, error: SV17(2000) });
  assert.match(over.error, /under 2000 characters/);
  assert.deepEqual(checkText("x".repeat(2000), 2000), { ok: true });
  assert.deepEqual(checkText(undefined, 2000), { ok: true });
  assert.deepEqual(checkText(42, 2000), { ok: true });
});

test("checkItinerary: a normal plan is ok", () => {
  assert.deepEqual(checkItinerary({ tier: "mid", days: [{ stops: [stop()], lodging: { name: "Hotel" } }] }), { ok: true });
  assert.deepEqual(checkItinerary(null), { ok: true });
});

test("checkItinerary: 16 stops in a day is 400; 15 is ok", () => {
  const day = (n) => ({ stops: Array.from({ length: n }, () => stop()) });
  const bad = checkItinerary({ days: [day(16)] });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  assert.deepEqual(checkItinerary({ days: [day(CAPS.stopsPerDay)] }), { ok: true });
});

test("checkItinerary: more than MAX_TRIP_DAYS days is 400", () => {
  const days = Array.from({ length: 31 }, () => ({ stops: [] }));
  const bad = checkItinerary({ days });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  assert.deepEqual(checkItinerary({ days: days.slice(0, 30) }), { ok: true });
});

test("checkItinerary: a long string anywhere deep is 400 with SV-17 at stringField", () => {
  const long = "x".repeat(501);
  for (const it of [
    { days: [{ stops: [stop({ description: long })] }] },
    { days: [{ lodging: { name: "Hotel", notes: { a: [long] } } }] },
    { days: [{ summary: long }] },
  ]) {
    assert.deepEqual(checkItinerary(it), { ok: false, status: 400, error: SV17(CAPS.stringField) });
  }
  assert.deepEqual(checkItinerary({ days: [{ summary: "x".repeat(500) }] }), { ok: true });
});

test("readJsonCapped: parses a small body", async () => {
  assert.deepEqual(await readJsonCapped(post('{"a":1}')), { a: 1 });
});

test("readJsonCapped: a 300 KB body is 413 with SV-17", async () => {
  const out = await readJsonCapped(post(JSON.stringify({ t: "x".repeat(300 * 1024) })));
  assert.deepEqual(out, { ok: false, status: 413, error: SV17(CAPS.bodyBytes) });
});

test("readJsonCapped: counts the stream when content-length is missing or lies", async () => {
  const big = new TextEncoder().encode(JSON.stringify({ t: "x".repeat(300 * 1024) }));
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(big.slice(0, 100 * 1024));
      c.enqueue(big.slice(100 * 1024));
      c.close();
    },
  });
  const req = new Request("http://x/api", { method: "POST", body: stream, duplex: "half", headers: { "content-length": "10" } });
  const out = await readJsonCapped(req);
  assert.equal(out.ok, false);
  assert.equal(out.status, 413);
});

test("readJsonCapped: unparsable JSON is 400", async () => {
  assert.deepEqual(await readJsonCapped(post("{bad")), { ok: false, status: 400, error: "Invalid request body." });
});

test("tooLongResponse: JSON { error, code } at the check's status", async () => {
  const res = tooLongResponse({ ok: false, status: 413, error: "e" });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: "e", code: "too_long" });
});
