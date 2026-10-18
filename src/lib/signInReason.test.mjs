/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/signInReason.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { signInReason } from "./signInReason.ts";

const reason = (q) => signInReason(new URLSearchParams(q));

// The sentences are the copy table's, rows S-05 and S-14, word for word.
const S05 =
  "You signed in, but TripMate couldn’t open your account on this server. Sign in again; if it keeps happening, this server’s account setup needs fixing.";
const s14 = (who) =>
  `Signing in with ${who} needs a step TripMate can’t show yet. Sign in with your email instead, or try ${who} again.`;

test("no reason in the address says nothing", () => {
  assert.equal(reason(""), null);
  assert.equal(reason("error=other"), null);
});

test("an account the server can't find is S-05", () => {
  assert.equal(reason("error=account"), S05);
});

test("an SSO step the form can't show is S-14, naming the provider from a fixed list only", () => {
  assert.equal(reason("error=sso&provider=google"), s14("Google"));
  assert.equal(reason("error=sso&provider=apple"), s14("Apple"));
  assert.equal(reason("error=sso"), s14("that account"));
  assert.equal(reason("error=sso&provider=%3Cscript%3E"), s14("that account"));
});
