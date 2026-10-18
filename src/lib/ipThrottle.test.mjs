import assert from "node:assert/strict";
import test from "node:test";
import { clientIp, isThrottled, throttleKeyCount } from "./ipThrottle.ts";

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

test("buckets are independent and max is per call", () => {
  const req = fakeRequest("9.9.9.9");
  for (let i = 0; i < 3; i += 1) isThrottled(req);
  assert.equal(isThrottled(req), true); // model bucket full
  assert.equal(isThrottled(req, { bucket: "import", max: 30 }), false); // import bucket untouched
  for (let i = 0; i < 29; i += 1) isThrottled(req, { bucket: "import", max: 30 });
  assert.equal(isThrottled(req, { bucket: "import", max: 30 }), true);
});

test("x-real-ip is the client address, so rotating x-forwarded-for buys no fresh bucket", () => {
  // The proxy sets x-real-ip; the leftmost x-forwarded-for entry is whatever the client sent.
  const req = (forged) => ({
    headers: { get: (name) => (name === "x-real-ip" ? "20.20.20.20" : name === "x-forwarded-for" ? `${forged}, 20.20.20.20` : null) },
  });
  for (let i = 0; i < 3; i += 1) assert.equal(isThrottled(req(`66.0.0.${i}`)), false);
  assert.equal(isThrottled(req("66.0.0.99")), true);
});

test("clientIp falls back to x-forwarded-for when no x-real-ip is set", () => {
  assert.equal(clientIp(fakeRequest("30.30.30.30, 10.0.0.1")), "30.30.30.30");
  assert.equal(clientIp({ headers: { get: () => null } }), null);
});

test("the key map stays bounded under a flood of distinct addresses", () => {
  for (let i = 0; i < 10_050; i += 1) isThrottled(fakeRequest(`77.${i >> 16 & 255}.${i >> 8 & 255}.${i & 255}`), { bucket: "flood" });
  assert.ok(throttleKeyCount() <= 10_000, `map grew to ${throttleKeyCount()}`);
});
