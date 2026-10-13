/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/onboardingDb.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { getOrCreateAccount, markOnboarded, needsOnboarding, rawDb } from "./db.ts";

const owner = (clerkId) => getOrCreateAccount(clerkId).owner_id;

test("a new account needs the welcome; a finished one does not", () => {
  const id = owner("user_onb_1");
  assert.equal(needsOnboarding(id), true);
  markOnboarded(id, false);
  assert.equal(needsOnboarding(id), false);
});

test("skipping counts as done", () => {
  const id = owner("user_onb_2");
  markOnboarded(id, true);
  assert.equal(needsOnboarding(id), false);
  assert.equal(rawDb.prepare(`SELECT onboarding_skipped FROM accounts WHERE owner_id = ?`).get(id).onboarding_skipped, 1);
});

test("an id with no account never needs it", () => {
  assert.equal(needsOnboarding("00000000-0000-4000-8000-000000000000"), false);
});

test("a finished welcome stays finished: a later call can't flip it to skipped", () => {
  const id = owner("user_onb_3");
  markOnboarded(id, false);
  const first = rawDb.prepare(`SELECT onboarded_at FROM accounts WHERE owner_id = ?`).get(id).onboarded_at;
  markOnboarded(id, true);
  const row = rawDb.prepare(`SELECT onboarded_at, onboarding_skipped FROM accounts WHERE owner_id = ?`).get(id);
  assert.equal(row.onboarding_skipped, 0);
  assert.equal(row.onboarded_at, first);
});
