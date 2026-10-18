import assert from "node:assert/strict";
import test from "node:test";
import { shouldFallBack } from "./streamRetry.ts";

const res = (status, body = {}) => ({ ok: status >= 200 && status < 300, body });

test("a refusal on the stream is never retried, so it makes exactly one request", () => {
  for (const status of [429, 503, 504, 500, 400]) {
    assert.equal(shouldFallBack({ response: res(status), aborted: false, online: true }), false, String(status));
  }
});

test("only a stream that never opened gets the one retry", () => {
  assert.equal(shouldFallBack({ aborted: false, online: true }), true);
  assert.equal(shouldFallBack({ response: res(200, null), aborted: false, online: true }), true);
  assert.equal(shouldFallBack({ response: res(200), aborted: false, online: true }), false);
});

test("no retry after a cancel, or while offline", () => {
  assert.equal(shouldFallBack({ aborted: true, online: true }), false);
  assert.equal(shouldFallBack({ aborted: false, online: false }), false);
});
