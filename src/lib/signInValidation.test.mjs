/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/signInValidation.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { signInProblems, EMAIL_EMPTY, EMAIL_MALFORMED, PASSWORD_SHORT } from "./signInValidation.ts";

test("a good email and a long enough password raise nothing", () => {
  assert.deepEqual(signInProblems("a@b.co", "x".repeat(15)), { email: undefined, password: undefined });
});

test("empty and malformed emails are told apart", () => {
  assert.equal(signInProblems("  ", "x".repeat(15)).email, EMAIL_EMPTY);
  assert.equal(signInProblems("nobody", "x".repeat(15)).email, EMAIL_MALFORMED);
  assert.equal(signInProblems("a b@c", "x".repeat(15)).email, EMAIL_MALFORMED);
});

test("a short or empty password names the minimum", () => {
  assert.equal(signInProblems("a@b.co", "").password, PASSWORD_SHORT);
  assert.equal(signInProblems("a@b.co", "x".repeat(14)).password, PASSWORD_SHORT);
  assert.match(PASSWORD_SHORT, /15 characters/);
});
