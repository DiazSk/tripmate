import assert from "node:assert/strict";
import test from "node:test";
import { isThrottled } from "./ipThrottle.ts";

function fakeRequest(ip) {
  return { headers: { get: (name) => (name === "x-forwarded-for" ? ip : null) } };
}

test("isThrottled allows the first few requests from an IP", () => {
  const prev = process.env.LLM_TRANSPORT;
  process.env.LLM_TRANSPORT = "api";
  try {
    const req = fakeRequest("1.2.3.4");
    assert.equal(isThrottled(req), false);
    assert.equal(isThrottled(req), false);
    assert.equal(isThrottled(req), false);
  } finally {
    process.env.LLM_TRANSPORT = prev;
  }
});

test("isThrottled trips once an IP exceeds the window limit", () => {
  const prev = process.env.LLM_TRANSPORT;
  process.env.LLM_TRANSPORT = "api";
  try {
    const req = fakeRequest("5.6.7.8");
    for (let i = 0; i < 3; i += 1) isThrottled(req);
    assert.equal(isThrottled(req), true);
  } finally {
    process.env.LLM_TRANSPORT = prev;
  }
});

test("isThrottled tracks IPs independently", () => {
  const prev = process.env.LLM_TRANSPORT;
  process.env.LLM_TRANSPORT = "api";
  try {
    const req = fakeRequest("9.9.9.9");
    for (let i = 0; i < 4; i += 1) isThrottled(req);
    assert.equal(isThrottled(fakeRequest("10.10.10.10")), false);
  } finally {
    process.env.LLM_TRANSPORT = prev;
  }
});

test("isThrottled is unconditionally false outside the api transport", () => {
  const prev = process.env.LLM_TRANSPORT;
  delete process.env.LLM_TRANSPORT;
  try {
    const req = fakeRequest("11.11.11.11");
    for (let i = 0; i < 10; i += 1) {
      assert.equal(isThrottled(req), false);
    }
  } finally {
    if (prev === undefined) delete process.env.LLM_TRANSPORT;
    else process.env.LLM_TRANSPORT = prev;
  }
});
