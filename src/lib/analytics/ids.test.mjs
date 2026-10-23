/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/analytics/ids.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { analyticsIdFor, distinctIdFromCookies, isInternalUser } from "./ids.ts";

const OWNER = "5b0c1f3e-7a2d-4f64-9c1e-0d3a8e6b2f11";

test("analyticsIdFor is stable for one owner and secret, 32 hex chars, and hides the owner id", () => {
  const id = analyticsIdFor(OWNER, "s1");
  assert.equal(id, analyticsIdFor(OWNER, "s1"));
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.ok(!id.includes(OWNER) && !id.includes(OWNER.replace(/-/g, "")));
});

test("analyticsIdFor differs across owners and across secrets", () => {
  assert.notEqual(analyticsIdFor(OWNER, "s1"), analyticsIdFor("another-owner", "s1"));
  assert.notEqual(analyticsIdFor(OWNER, "s1"), analyticsIdFor(OWNER, "s2"));
});

test("distinctIdFromCookies reads PostHog's URL-encoded cookie among others", () => {
  const value = encodeURIComponent(JSON.stringify({ distinct_id: "abc-123", $sesid: [1, "x"] }));
  assert.equal(distinctIdFromCookies(`a=b; ph_phc_k_posthog=${value}; c=d`, "phc_k"), "abc-123");
});

test("distinctIdFromCookies is null for no header, no cookie, bad JSON, a missing field and another project's cookie", () => {
  assert.equal(distinctIdFromCookies(null, "phc_k"), null);
  assert.equal(distinctIdFromCookies("a=b", "phc_k"), null);
  assert.equal(distinctIdFromCookies("ph_phc_k_posthog=%7Bnot-json", "phc_k"), null);
  assert.equal(distinctIdFromCookies(`ph_phc_k_posthog=${encodeURIComponent("{}")}`, "phc_k"), null);
  const other = encodeURIComponent(JSON.stringify({ distinct_id: "zzz" }));
  assert.equal(distinctIdFromCookies(`ph_phc_other_posthog=${other}`, "phc_k"), null);
});

test("isInternalUser matches a trimmed allowlist and is false for null or unset", () => {
  assert.equal(isInternalUser("user_2", " user_1 , user_2 ,"), true);
  assert.equal(isInternalUser("user_3", "user_1,user_2"), false);
  assert.equal(isInternalUser(null, "user_1"), false);
  assert.equal(isInternalUser("user_1", undefined), false);
  assert.equal(isInternalUser("", ""), false);
});
