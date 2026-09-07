/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/fetchCache.test.mjs
 *
 * The read-through cache every third-party fetch now goes through. Worth testing carefully for
 * the same reason `overpass.ts` is: every path here is silent by design. A cache that quietly
 * stores a failure looks exactly like one working correctly, right up until a destination has
 * been frozen as "no highways" for ninety days.
 *
 * Unlike most siblings this file opens a database, so it points DB_PATH at a scratch file and
 * imports dynamically afterwards — `db.ts` reads that variable at import time and a static import
 * is hoisted above any assignment. Same dance as `export/exportMapCache.test.mjs`, and the reason
 * this file can count rows freely while `db.test.mjs` (which writes to the developer's real
 * tripmate.db) deliberately does not.
 *
 * No network anywhere: the "fetcher" is a plain function with a call counter. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "tripmate-fetchcache-")), "t.db");
const { cached, TTL } = await import("./fetchCache.ts");
const { getFetchCache, saveFetchCache } = await import("./db.ts");
process.on("exit", () => rmSync(path.dirname(process.env.DB_PATH), { recursive: true, force: true }));

let keyN = 0;
/** A fresh key per test, so ordering between tests can never matter. */
const k = (name) => `test:${name}:${++keyN}`;

/** A fetcher that records how many times it ran. */
function counting(value) {
  const f = async () => {
    f.calls++;
    return value;
  };
  f.calls = 0;
  return f;
}

const HOUR = 60 * 60 * 1000;

test("a cold key runs the fetcher and stores the answer", async () => {
  const key = k("cold");
  const f = counting({ segments: [1, 2] });
  assert.deepEqual(await cached(key, TTL.STATIC, f), { segments: [1, 2] });
  assert.equal(f.calls, 1);
  assert.deepEqual(JSON.parse(getFetchCache(key).payload_json), { segments: [1, 2] });
});

test("a hit inside the TTL does not call the fetcher at all", async () => {
  const key = k("warm");
  await cached(key, TTL.STATIC, counting({ v: 1 }));
  const second = counting({ v: 2 });
  assert.deepEqual(await cached(key, TTL.STATIC, second), { v: 1 }, "served the stored answer");
  assert.equal(second.calls, 0, "the whole point: no outbound call");
});

test("past the TTL the fetcher runs again and overwrites", async () => {
  const key = k("stale");
  await cached(key, TTL.VOLATILE, counting({ v: "old" }));
  const later = counting({ v: "new" });
  // Injected clock rather than a real wait — same trick `staleDraftCutoff(now)` exists for.
  const result = await cached(key, TTL.VOLATILE, later, Date.now() + 2 * HOUR);
  assert.deepEqual(result, { v: "new" });
  assert.equal(later.calls, 1);
  assert.deepEqual(JSON.parse(getFetchCache(key).payload_json), { v: "new" });
});

test("null is never written — a failure must not become a cached fact", async () => {
  const key = k("nullmiss");
  assert.equal(await cached(key, TTL.STATIC, counting(null)), null);
  assert.equal(getFetchCache(key), undefined, "nothing at all was stored");
});

test("stale-if-error: an expired row is served when the fetcher cannot answer", async () => {
  // The reason there is no sweep. On the day all three Overpass mirrors refuse, a 100-day-old
  // highway row is the difference between a map and a grey box.
  const key = k("staleiferror");
  await cached(key, TTL.STATIC, counting({ roads: ["A1"] }));
  const failing = counting(null);
  const result = await cached(key, TTL.STATIC, failing, Date.now() + 400 * 24 * HOUR);
  assert.equal(failing.calls, 1, "it did try to refresh first");
  assert.deepEqual(result, { roads: ["A1"] }, "and fell back to the expired copy");
});

test("a successful refresh replaces the stale row rather than keeping it", async () => {
  const key = k("refresh");
  await cached(key, TTL.STATIC, counting({ n: 1 }));
  await cached(key, TTL.STATIC, counting({ n: 2 }), Date.now() + 400 * 24 * HOUR);
  assert.deepEqual(JSON.parse(getFetchCache(key).payload_json), { n: 2 });
});

test("corrupt stored JSON degrades to a miss, never a throw", async () => {
  const key = k("corrupt");
  saveFetchCache(key, "{not json at all");
  const f = counting({ ok: true });
  assert.deepEqual(await cached(key, TTL.STATIC, f), { ok: true });
  assert.equal(f.calls, 1);
});

test("a corrupt row that cannot be refreshed returns null rather than throwing", async () => {
  const key = k("corruptdead");
  saveFetchCache(key, "]]]");
  assert.equal(await cached(key, TTL.STATIC, counting(null)), null);
});

test("an empty array the caller chose to return IS cached — only null is refused", async () => {
  // The wrapper cannot know whether [] means "nothing there" or "could not ask". That judgement
  // belongs to the call site, which says "could not ask" by returning null.
  const key = k("emptyok");
  await cached(key, TTL.STATIC, counting([]));
  const second = counting(["should not be reached"]);
  assert.deepEqual(await cached(key, TTL.STATIC, second), []);
  assert.equal(second.calls, 0);
});

test("keys are independent — one destination's answer never serves another's", async () => {
  const a = k("iso");
  const b = k("iso");
  await cached(a, TTL.STATIC, counting({ city: "Lisbon" }));
  assert.deepEqual(await cached(b, TTL.STATIC, counting({ city: "Kyoto" })), { city: "Kyoto" });
  assert.deepEqual(JSON.parse(getFetchCache(a).payload_json), { city: "Lisbon" });
});

test("TTLs are ordered as their names claim", () => {
  // Cheap, but this is a policy table someone will edit by hand.
  assert.ok(TTL.VOLATILE < TTL.CHURNING);
  assert.ok(TTL.CHURNING < TTL.SLOW);
  assert.ok(TTL.SLOW < TTL.STATIC);
});
