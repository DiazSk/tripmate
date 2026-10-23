/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/analytics/flow.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { attemptFor, notePath, previousPath, rememberAttempt, tripSource } from "./flow.ts";

test("a trip page's source follows the route it came from, then the referrer, else a link", () => {
  assert.equal(tripSource("/", null), "home");
  assert.equal(tripSource("/trips", "/"), "trips");
  assert.equal(tripSource("/s/abc", null), "share");
  assert.equal(tripSource(null, "/trips"), "trips");
  assert.equal(tripSource(null, null), "link");
  assert.equal(tripSource("/profile", null), "link");
});

test("notePath is idempotent, so its callers can run in any order", () => {
  notePath("/");
  notePath("/trip/x");
  notePath("/trip/x");
  assert.equal(previousPath(), "/");
});

test("an attempt is remembered per trip, and a missing id remembers nothing", () => {
  rememberAttempt("t1", "11111111-1111-4111-8111-111111111111");
  rememberAttempt("t2", null);
  assert.equal(attemptFor("t1"), "11111111-1111-4111-8111-111111111111");
  assert.equal(attemptFor("t2"), undefined);
});
