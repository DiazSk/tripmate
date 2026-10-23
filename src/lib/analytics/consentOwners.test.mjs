/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/analytics/consentOwners.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { consentOwners, consentWriteOwners, deviceOwner } from "./consentOwners.ts";

const account = randomUUID();
const anon = randomUUID();
const isAccount = (id) => id === account;

test("a signed-in device writes to the account and to its anonymous owner", () => {
  assert.deepEqual(consentOwners(account, anon, isAccount), [account, anon]);
});

test("a signed-out device, or one with no cookie, writes to its one owner", () => {
  assert.deepEqual(consentOwners(anon, anon, isAccount), [anon]);
  assert.deepEqual(consentOwners(anon, undefined, isAccount), [anon]);
});

test("a cookie that is malformed, the legacy bucket, or an account's id is never a device owner", () => {
  assert.equal(deviceOwner("not-an-owner", anon, isAccount), null);
  assert.equal(deviceOwner("", anon, isAccount), null);
  assert.equal(deviceOwner(account, anon, isAccount), null);
  assert.equal(deviceOwner(randomUUID(), anon, () => true), null);
});

test("a Yes is written only to the request's own owner, a No to every owner the device holds", () => {
  // Signed in: a Yes must not land on the device's anonymous row, or the next account to sign in here inherits it.
  assert.deepEqual(consentWriteOwners(true, account, anon, isAccount), [account]);
  assert.deepEqual(consentWriteOwners(false, account, anon, isAccount), [account, anon]);
  assert.deepEqual(consentWriteOwners(true, anon, anon, isAccount), [anon]);
  assert.deepEqual(consentWriteOwners(false, anon, undefined, isAccount), [anon]);
});
