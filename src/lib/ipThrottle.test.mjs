import assert from "node:assert/strict";
import test from "node:test";
import { clientIp, LIMITS, throttle, throttleKeyCount } from "./ipThrottle.ts";

const MIN = 60_000;

function fakeRequest(ip) {
  return { headers: { get: (name) => (name === "x-forwarded-for" ? ip : null) } };
}

test("throttle allows a bucket's max, then refuses", () => {
  const req = fakeRequest("5.6.7.8");
  for (let i = 0; i < LIMITS.plan.max; i += 1) assert.equal(throttle(req, "plan").limited, false);
  const refused = throttle(req, "plan");
  assert.equal(refused.limited, true);
  assert.equal(refused.limit, 3);
  assert.equal(refused.windowMinutes, 10);
});

test("throttle tracks IPs independently", () => {
  const req = fakeRequest("9.9.9.9");
  for (let i = 0; i < 4; i += 1) throttle(req, "plan");
  assert.equal(throttle(fakeRequest("10.10.10.10"), "plan").limited, false);
});

test("throttle sits out when there is no per-IP signal to work from", () => {
  // A direct localhost request sets no forwarding header, so every caller would share one
  // bucket and an ordinary dev session would trip this. The transport is deliberately not
  // consulted: a CLI-transport server behind a tunnel has real IPs and does need the limit.
  const req = { headers: { get: () => null } };
  for (let i = 0; i < 10; i += 1) assert.equal(throttle(req, "plan").limited, false);
});

test("throttle applies regardless of transport, given a real IP", () => {
  const prev = process.env.LLM_TRANSPORT;
  delete process.env.LLM_TRANSPORT;
  try {
    const req = fakeRequest("12.12.12.12");
    for (let i = 0; i < LIMITS.plan.max; i += 1) throttle(req, "plan");
    assert.equal(throttle(req, "plan").limited, true);
  } finally {
    if (prev === undefined) delete process.env.LLM_TRANSPORT;
    else process.env.LLM_TRANSPORT = prev;
  }
});

test("loopback is no signal", () => {
  // `next start` itself forwards a direct request with x-forwarded-for: ::1, so loopback would
  // otherwise put every local caller in one bucket.
  for (const ip of ["::1", "127.0.0.1", "::ffff:127.0.0.1"]) {
    for (let i = 0; i < 10; i += 1) assert.equal(throttle(fakeRequest(ip), "plan").limited, false, ip);
    assert.equal(clientIp(fakeRequest(ip)), null, ip);
  }
});

test("refused requests are not recorded", () => {
  const req = fakeRequest("40.40.40.40");
  const t0 = 1_000_000_000_000;
  for (let i = 0; i < LIMITS.plan.max; i += 1) throttle(req, "plan", t0);
  assert.equal(throttle(req, "plan", t0 + MIN).retryAfterSeconds, 9 * 60);
  for (let i = 0; i < 10; i += 1) throttle(req, "plan", t0 + 2 * MIN);
  assert.equal(throttle(req, "plan", t0 + 2 * MIN).retryAfterSeconds, 8 * 60);
  // And the window reopens when the accepted ones age out, however many refusals came between.
  assert.equal(throttle(req, "plan", t0 + 10 * MIN).limited, false);
});

test("retryAfterSeconds counts from the oldest accepted request", () => {
  const req = fakeRequest("41.41.41.41");
  const t0 = 1_000_000_000_000;
  throttle(req, "plan", t0);
  throttle(req, "plan", t0 + 3 * MIN);
  throttle(req, "plan", t0 + 5 * MIN);
  assert.deepEqual(throttle(req, "plan", t0 + 6 * MIN), {
    limited: true,
    retryAfterSeconds: 4 * 60,
    limit: 3,
    windowMinutes: 10,
  });
});

test("buckets are separate", () => {
  const req = fakeRequest("42.42.42.42");
  for (let i = 0; i < LIMITS.plan.max; i += 1) throttle(req, "plan");
  assert.equal(throttle(req, "plan").limited, true);
  assert.equal(throttle(req, "place-detail").limited, false);
  for (let i = 0; i < LIMITS.import.max; i += 1) assert.equal(throttle(req, "import").limited, false);
  assert.equal(throttle(req, "import").limited, true);
});

test("x-real-ip is the client address, so rotating x-forwarded-for buys no fresh bucket", () => {
  // The proxy sets x-real-ip; the leftmost x-forwarded-for entry is whatever the client sent.
  const req = (forged) => ({
    headers: { get: (name) => (name === "x-real-ip" ? "20.20.20.20" : name === "x-forwarded-for" ? `${forged}, 20.20.20.20` : null) },
  });
  for (let i = 0; i < 3; i += 1) assert.equal(throttle(req(`66.0.0.${i}`), "plan").limited, false);
  assert.equal(throttle(req("66.0.0.99"), "plan").limited, true);
});

test("clientIp falls back to x-forwarded-for when no x-real-ip is set", () => {
  assert.equal(clientIp(fakeRequest("30.30.30.30, 10.0.0.1")), "30.30.30.30");
  assert.equal(clientIp({ headers: { get: () => null } }), null);
});

test("the key map stays bounded under a flood of distinct addresses", () => {
  for (let i = 0; i < 10_050; i += 1) throttle(fakeRequest(`77.${i >> 16 & 255}.${i >> 8 & 255}.${i & 255}`), "geocode-place");
  assert.ok(throttleKeyCount() <= 10_000, `map grew to ${throttleKeyCount()}`);
});

test("an IPv6 client is keyed by its /64, so the host half buys no fresh bucket", () => {
  const a = clientIp(fakeRequest("2001:db8:1:2:aaaa::1"));
  assert.equal(a, "2001:db8:1:2::/64");
  assert.equal(clientIp(fakeRequest("2001:db8:1:2:bbbb::9")), a);
  // Compressed inside the first four groups, and uppercase.
  assert.equal(clientIp(fakeRequest("2001:DB8::5:1")), "2001:db8:0:0::/64");
  assert.equal(clientIp(fakeRequest("2001:db8:1:2:3:4:5:6")), "2001:db8:1:2::/64");
  assert.equal(clientIp(fakeRequest("::2")), "0:0:0:0::/64");
  const req = fakeRequest("2001:db8:77:1:1::1");
  for (let i = 0; i < LIMITS.plan.max; i += 1) assert.equal(throttle(req, "plan").limited, false);
  assert.equal(throttle(fakeRequest("2001:db8:77:1:ffff::2"), "plan").limited, true);
});

test("an IPv4-mapped IPv6 address is the IPv4 address; IPv4 is unchanged", () => {
  assert.equal(clientIp(fakeRequest("::ffff:203.0.113.5")), "203.0.113.5");
  assert.equal(clientIp(fakeRequest("203.0.113.5")), "203.0.113.5");
});

test("the context, lookup and refusal buckets", () => {
  assert.deepEqual(LIMITS.context, { max: 10, windowMinutes: 10 });
  assert.deepEqual(LIMITS.lookup, { max: 120, windowMinutes: 10 });
  assert.deepEqual(LIMITS.refusal, { max: 30, windowMinutes: 10 });
});
