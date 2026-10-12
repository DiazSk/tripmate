/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/onboardingDb.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { markOnboarded, needsOnboarding, rawDb } from "./db.ts";

function makeUser(id) {
  const now = new Date().toISOString();
  rawDb.prepare(`INSERT INTO "user" ("id","name","email","emailVerified","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`)
    .run(id, "Zaid", `${id}@example.com`, 0, now, now);
}

test("a new account needs the welcome; a finished one does not", () => {
  makeUser("u-onb-1");
  assert.equal(needsOnboarding("u-onb-1"), true);
  markOnboarded("u-onb-1", false);
  assert.equal(needsOnboarding("u-onb-1"), false);
});

test("skipping counts as done", () => {
  makeUser("u-onb-2");
  markOnboarded("u-onb-2", true);
  assert.equal(needsOnboarding("u-onb-2"), false);
  assert.equal(rawDb.prepare(`SELECT onboarding_skipped FROM "user" WHERE id = ?`).get("u-onb-2").onboarding_skipped, 1);
});

test("an id with no account never needs it", () => {
  assert.equal(needsOnboarding("nobody"), false);
});
