/**
 * The shared Overpass client's failover contract.
 *
 * Worth testing where almost nothing network-touching in this repo is, because every one of its
 * failure paths is silent by design: a caller that gets `null` degrades rather than throwing, so a
 * broken failover looks exactly like "that city has no motorways". These stub `fetch` rather than
 * reaching the network — the point is the ordering and the null-vs-empty distinction, not Overpass.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { OVERPASS_URLS, askOverpass } from "./overpass.ts";

const realFetch = globalThis.fetch;

/** Records which URLs were tried, in order, and answers each per `plan`. */
function stubFetch(plan) {
  const tried = [];
  globalThis.fetch = async (url) => {
    tried.push(url);
    const outcome = plan(url);
    if (outcome === "refuse") throw new Error("connection refused");
    if (outcome === "500") return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => outcome };
  };
  return tried;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("falls past a refusing mirror to one that answers", async () => {
  const tried = stubFetch((url) =>
    url === OVERPASS_URLS[0] ? "refuse" : { elements: [{ id: 1 }] }
  );
  const out = await askOverpass("[out:json];node(1);out;");
  assert.deepEqual(out, [{ id: 1 }]);
  assert.deepEqual(tried, [OVERPASS_URLS[0], OVERPASS_URLS[1]], "tries the primary first, then the next");
});

test("the mirror that worked is tried first next time", async () => {
  // Depends on the previous test having learned index 1 — that persistence is the whole feature.
  // A dead primary otherwise costs 2-20s on *every* query, and cityBoundary fires three per city.
  const tried = stubFetch(() => ({ elements: [] }));
  await askOverpass("[out:json];node(1);out;");
  assert.deepEqual(tried, [OVERPASS_URLS[1]], "goes straight to the learned mirror, no retry of the dead one");
});

test("a learned mirror going down still falls through, and re-learns", async () => {
  const tried = stubFetch((url) => (url === OVERPASS_URLS[1] ? "refuse" : { elements: [{ id: 2 }] }));
  const out = await askOverpass("[out:json];node(1);out;");
  assert.deepEqual(out, [{ id: 2 }]);
  assert.equal(tried[0], OVERPASS_URLS[1], "still starts at the learned one");
  assert.equal(tried.length, 2, "wraps to the next rather than giving up");

  // …and the new one sticks.
  const again = stubFetch(() => ({ elements: [] }));
  await askOverpass("[out:json];node(1);out;");
  assert.equal(again.length, 1, "re-learned, so no wasted attempt");
});

test("an HTTP 200 carrying a `remark` is a failure, not an empty answer", async () => {
  // Overpass reports a server-side query timeout this way. Taken at face value it reads as
  // "there is nothing there", which is the exact confusion the null-vs-empty convention exists
  // to prevent — and every caller but one was making it.
  // Keyed on call order, not on a specific URL: which mirror is tried first depends on what the
  // tests above left learned, and that is the client's business rather than this assertion's.
  let call = 0;
  const tried = stubFetch(() =>
    call++ === 0 ? { elements: [], remark: "runtime error: Query timed out" } : { elements: [{ id: 3 }] }
  );
  const out = await askOverpass("[out:json];node(1);out;");
  assert.deepEqual(out, [{ id: 3 }], "the remark fell through to a mirror that really answered");
  assert.equal(tried.length, 2, "a remark must not be accepted as the answer");
});

test("every mirror failing is null, never []", async () => {
  stubFetch(() => "refuse");
  assert.equal(await askOverpass("[out:json];node(1);out;"), null);
});

test("a real empty result is [], never null", async () => {
  stubFetch(() => ({ elements: [] }));
  assert.deepEqual(await askOverpass("[out:json];node(1);out;"), []);
});

test("a 200 with no `elements` key at all is still an empty answer, not a failure", async () => {
  stubFetch(() => ({}));
  assert.deepEqual(await askOverpass("[out:json];node(1);out;"), []);
});
