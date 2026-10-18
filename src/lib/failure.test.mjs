/* Run: npm test (needs --import ./scripts/ts-resolve.mjs, since failure.ts imports actionHolds extensionless) */
import assert from "node:assert/strict";
import test from "node:test";
import { OFF_TOPIC_SENTENCES, offTopicResponse } from "./limitResponse.ts";
import { failureFromResponse, failureFromStreamError, failureFromThrown, isAbort } from "./failure.ts";

const res = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

test("statuses map to kinds", async () => {
  assert.deepEqual(await failureFromResponse(res(400, { error: "Pick a date." }), "plan"), { kind: "invalid", message: "Pick a date." });
  assert.deepEqual(await failureFromResponse(res(422, { error: "No." }), "plan"), { kind: "invalid", message: "No." });
  assert.equal((await failureFromResponse(res(401, {}), "plan")).kind, "signed_out");
  assert.equal((await failureFromResponse(res(404, {}), "plan")).kind, "not_found");
  assert.equal((await failureFromResponse(res(504, {}), "plan")).kind, "timeout");
  assert.equal((await failureFromResponse(res(500, {}), "plan")).kind, "server");
  assert.equal((await failureFromResponse(res(502), "plan")).kind, "server");
  assert.equal((await failureFromResponse(res(500, { code: "timeout" }), "plan")).kind, "timeout");
});

test("a 429 body round-trips", async () => {
  const f = await failureFromResponse(
    res(429, { code: "rate_limited", bucket: "edit", retryAfterSeconds: 342, limit: 6, windowMinutes: 10 }, { "Retry-After": "342" }),
  );
  assert.deepEqual(f, { kind: "rate_limited", bucket: "edit", retryAfterSeconds: 342, limit: 6, windowMinutes: 10 });
});

test("a 429 with no body falls back to Retry-After and the caller's bucket", async () => {
  const f = await failureFromResponse(res(429, undefined, { "Retry-After": "90" }), "story");
  assert.equal(f.kind, "rate_limited");
  assert.equal(f.retryAfterSeconds, 90);
  assert.equal(f.bucket, "story");
});

test("an unknown body bucket falls back to the hint; a known one wins", async () => {
  const bad = await failureFromResponse(res(429, { code: "rate_limited", bucket: "bogus", retryAfterSeconds: 5 }), "edit");
  assert.equal(bad.bucket, "edit");
  const ok = await failureFromResponse(res(429, { code: "rate_limited", bucket: "story", retryAfterSeconds: 5 }), "edit");
  assert.equal(ok.bucket, "story");
});

test("a 429 still honours a recognised code; empty invalid text is a server failure", async () => {
  assert.equal((await failureFromResponse(res(429, { code: "daily_cap", retryAfterSeconds: 5 }), "plan")).kind, "daily_cap");
  assert.equal((await failureFromResponse(res(400, { error: "" }), "plan")).kind, "server");
  assert.equal((await failureFromResponse(res(400, {}), "plan")).kind, "server");
});

test("the daily cap resolves to a resume time", async () => {
  const f = await failureFromResponse(res(503, { code: "daily_cap", retryAfterSeconds: 600 }), "plan", 1_000_000);
  assert.deepEqual(f, { kind: "daily_cap", resumesAt: new Date(1_600_000) });
});

test("an SSE error event maps the same way", () => {
  assert.equal(failureFromStreamError({ error: "x", code: "timeout" }, "plan").kind, "timeout");
  assert.equal(failureFromStreamError({ code: "daily_cap", retryAfterSeconds: 5 }, "plan", 0).resumesAt.getTime(), 5000);
  assert.equal(failureFromStreamError("nope", "plan").kind, "server");
  assert.equal(failureFromStreamError(null, "plan").kind, "server");
});

test("thrown errors never leak their message", () => {
  const e = new TypeError("Failed to fetch");
  assert.equal(failureFromThrown(e, false).kind, "offline");
  assert.equal(failureFromThrown(e, true).kind, "server");
  assert.equal(failureFromThrown(new DOMException("t", "TimeoutError"), true).kind, "timeout");
  const abort = new DOMException("c", "AbortError");
  assert.ok(isAbort(abort) && !isAbort(e));
  assert.notEqual(failureFromThrown(abort, true).kind, "timeout");
  for (const f of [failureFromThrown(e, false), failureFromThrown(e, true), failureFromThrown(new Error("boom"))]) {
    assert.ok(!JSON.stringify(f).includes("Failed to fetch") && !JSON.stringify(f).includes("boom"));
  }
});

test("formatResumeTime says the cap's end on the traveller's clock", async () => {
  const { formatResumeTime } = await import("./failure.ts");
  const now = new Date(2026, 9, 17, 10, 0);
  assert.equal(formatResumeTime(new Date(2026, 9, 17, 15, 15), now), "about 3:15 this afternoon");
  assert.equal(formatResumeTime(new Date(2026, 9, 17, 23, 20), now), "about 11:20 tonight");
  assert.equal(formatResumeTime(new Date(2026, 9, 18, 9, 40), now), "about 9:40 tomorrow morning");
  assert.equal(formatResumeTime(new Date(2026, 9, 18, 0, 5), now), "about 12:05 tomorrow morning");
});

test("off_topic and too_long map to refused with the server's sentence, from a response or a stream", async () => {
  const chat = OFF_TOPIC_SENTENCES.chat;
  assert.deepEqual(await failureFromResponse(offTopicResponse("chat"), "edit"), { kind: "refused", message: chat });
  assert.deepEqual(failureFromStreamError({ code: "off_topic", error: OFF_TOPIC_SENTENCES.refine }, "plan"), {
    kind: "refused",
    message: OFF_TOPIC_SENTENCES.refine,
  });
  assert.deepEqual(await failureFromResponse(res(413, { error: "Too long.", code: "too_long" }), "edit"), { kind: "refused", message: "Too long." });
  assert.deepEqual(failureFromStreamError({ code: "too_long", error: "Too long." }, "plan"), { kind: "refused", message: "Too long." });
  assert.deepEqual(await failureFromResponse(res(400, { error: "Too long.", code: "too_long" }), "plan"), { kind: "refused", message: "Too long." });
  // A code with no sentence to show is not a refusal.
  assert.equal(failureFromStreamError({ code: "off_topic" }, "plan").kind, "server");
});

test("bad_request with a sentence (SV-21..23) maps to refused, from a response or a stream", async () => {
  const unreadable = "TripMate couldn’t read that request. Try again, and if it keeps happening, reload the page.";
  assert.deepEqual(await failureFromResponse(res(400, { error: unreadable, code: "bad_request" }), "edit"), {
    kind: "refused",
    message: unreadable,
  });
  assert.deepEqual(failureFromStreamError({ code: "bad_request", error: unreadable }, "plan"), {
    kind: "refused",
    message: unreadable,
  });
  assert.equal(failureFromStreamError({ code: "bad_request" }, "plan").kind, "server");
});
