import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS } from "./ipThrottle.ts";
import { OFF_TOPIC_SENTENCES, capResponse, limitResponse, modelFailureResponse, offTopicResponse, routeLimitSentence, unit } from "./limitResponse.ts";
import { ModelTimeoutError } from "./modelTimeout.ts";

// Copy table rows SV-01..SV-13, SV-18, SV-19 (docs/superpowers/plans/2026-10-17-error-messages-copy.md,
// section 9), with {minutes} = 5 for retryAfterSeconds 241..300.
const SV = {
  plan: "You’ve planned 3 trips in the last 10 minutes, which is the limit. You can plan another in about 5 minutes.",
  edit: "You’ve asked TripMate for 6 changes in the last 10 minutes, which is the limit. You can ask for another in about 5 minutes.",
  "place-detail": "You’ve opened the details of 10 places in the last 10 minutes, which is the limit. You can open another in about 5 minutes.",
  story: "You’ve started 6 new stories in the last 10 minutes, which is the limit. New stories are back in about 5 minutes.",
  import: "You’ve asked TripMate to read places 30 times in the last 10 minutes, which is the limit. You can try again in about 5 minutes.",
  "import-plan": "You’ve brought in 30 plans in the last 10 minutes, which is the limit. You can try again in about 5 minutes.",
  "import-plan-complete": "You’ve saved 30 imported plans in the last 10 minutes, which is the limit. You can try again in about 5 minutes.",
  "geocode-place": "You’ve looked up 60 places in the last 10 minutes, which is the limit. You can look again in about 5 minutes.",
  context: "TripMate looked up 10 destinations in the last 10 minutes, which is the limit. It can look up another in about 5 minutes.",
  lookup: "TripMate looked up a lot of places in the last 10 minutes. It can look again in about 5 minutes.",
};

test("every bucket has its copy row, and the 429 carries the structured body", async () => {
  // `refusal` is internal: it is counted, never answered as a 429.
  assert.deepEqual(Object.keys(SV).sort(), Object.keys(LIMITS).filter((b) => b !== "refusal").sort());
  for (const [bucket, sentence] of Object.entries(SV)) {
    const { max, windowMinutes } = LIMITS[bucket];
    const res = limitResponse({ limited: true, retryAfterSeconds: 241, limit: max, windowMinutes }, bucket);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "241");
    assert.deepEqual(await res.json(), {
      error: sentence,
      code: "rate_limited",
      bucket,
      retryAfterSeconds: 241,
      limit: max,
      windowMinutes,
    });
  }
});

test("the daily cap is a 503 with hours rounded up and Retry-After in seconds", async () => {
  const now = Date.parse("2031-01-01T12:00:00.000Z");
  const res = capResponse(new Date(now + 2 * 3_600_000 + 1_500), now);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(res.headers.get("Retry-After"), String(body.retryAfterSeconds));
  assert.deepEqual(body, {
    error:
      "Planning and changes by TripMate are paused for everyone for about 3 more hours. It has reached its limit for the day; it isn’t anything you did. Your trips, hand edits and the map still work.",
    code: "daily_cap",
    retryAfterSeconds: 7202,
  });
});

test("a model timeout is a 504 with its action's sentence; anything else stays a 500", async () => {
  const SV_TIMEOUT = {
    plan: "Writing your plan took longer than TripMate allows, so it stopped. Your answers are kept. Try again.",
    edit: "TripMate took longer than it allows to make that change, so it stopped. Your plan is unchanged. Try again.",
    "place-detail":
      "Writing the details for this place took longer than TripMate allows, so it stopped. Your plan is unchanged. Try again.",
  };
  for (const [action, sentence] of Object.entries(SV_TIMEOUT)) {
    const timedOut = modelFailureResponse(new ModelTimeoutError("claude CLI timed out after 5ms"), "Edit failed", action);
    assert.equal(timedOut.status, 504);
    assert.deepEqual(await timedOut.json(), { error: sentence, code: "timeout" });
  }
  const other = modelFailureResponse(new Error("Unexpected token"), "Edit failed", "edit");
  assert.equal(other.status, 500);
  assert.deepEqual(await other.json(), { error: "Edit failed" });
});

test("a value of 1 takes the singular unit, 2 the plural", async () => {
  assert.equal(unit(1, "minute"), "minute");
  assert.equal(unit(2, "minute"), "minutes");
  const one = await limitResponse({ limited: true, retryAfterSeconds: 45, limit: 3, windowMinutes: 10 }, "plan").json();
  assert.match(one.error, /in about 1 minute\.$/);
  const two = await limitResponse({ limited: true, retryAfterSeconds: 61, limit: 3, windowMinutes: 10 }, "plan").json();
  assert.match(two.error, /in about 2 minutes\.$/);
  const now = 0;
  assert.match((await capResponse(new Date(3_600_000), now).json()).error, /about 1 more hour\./);
  assert.match((await capResponse(new Date(3_600_001), now).json()).error, /about 2 more hours\./);
  assert.equal(routeLimitSentence(1), "Too many walking-time lookups in the last minute. They’ll be ready again in about 1 second.");
  assert.equal(routeLimitSentence(2), "Too many walking-time lookups in the last minute. They’ll be ready again in about 2 seconds.");
});

// Copy table rows SV-14..SV-16.
const OFF_TOPIC = {
  chat: "TripMate can only help with this trip: its stops, timing, costs and getting around. Ask about the plan, or ask for a change to it.",
  element: "TripMate can only swap this stop for another place to go. Describe the stop you’d like instead.",
  refine: "TripMate can only change this trip. Say what you’d like different about the plan.",
};

test("offTopicResponse is a 422 off_topic carrying the copy row for its surface", async () => {
  assert.deepEqual(OFF_TOPIC_SENTENCES, OFF_TOPIC);
  for (const [kind, error] of Object.entries(OFF_TOPIC)) {
    const res = offTopicResponse(kind);
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error, code: "off_topic" });
  }
});
