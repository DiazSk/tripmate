import assert from "node:assert/strict";
import test from "node:test";
import { isThrottled } from "./ipThrottle.ts";

function fakeRequest(ip) {
  return { headers: { get: (name) => (name === "x-forwarded-for" ? ip : null) } };
}

test("isThrottled allows the first few requests from an IP", () => {
  const req = fakeRequest("1.2.3.4");
  assert.equal(isThrottled(req), false);
  assert.equal(isThrottled(req), false);
  assert.equal(isThrottled(req), false);
});

test("isThrottled trips once an IP exceeds the window limit", () => {
  const req = fakeRequest("5.6.7.8");
  for (let i = 0; i < 3; i += 1) isThrottled(req);
  assert.equal(isThrottled(req), true);
});

test("isThrottled tracks IPs independently", () => {
  const req = fakeRequest("9.9.9.9");
  for (let i = 0; i < 4; i += 1) isThrottled(req);
  assert.equal(isThrottled(fakeRequest("10.10.10.10")), false);
});

test("isThrottled sits out when there is no per-IP signal to work from", () => {
  // A direct localhost request sets no `x-forwarded-for`, so every caller would share one
  // bucket and an ordinary dev session would trip this. The transport is deliberately not
  // consulted: a CLI-transport server behind a tunnel has real IPs and does need the limit.
  const req = { headers: { get: () => null } };
  for (let i = 0; i < 10; i += 1) assert.equal(isThrottled(req), false);
});

test("isThrottled applies regardless of transport, given a real IP", () => {
  const prev = process.env.LLM_TRANSPORT;
  delete process.env.LLM_TRANSPORT;
  try {
    const req = fakeRequest("12.12.12.12");
    for (let i = 0; i < 3; i += 1) isThrottled(req);
    assert.equal(isThrottled(req), true);
  } finally {
    if (prev === undefined) delete process.env.LLM_TRANSPORT;
    else process.env.LLM_TRANSPORT = prev;
  }
});
