/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/afterSignIn.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { afterSignInPath } from "./afterSignIn.ts";

test("a new account goes to the welcome, carrying next when it is not the default", () => {
  assert.equal(afterSignInPath({ needsOnboarding: true, next: "/trips" }), "/welcome");
  assert.equal(afterSignInPath({ needsOnboarding: true, next: "/profile" }), "/welcome?next=%2Fprofile");
});

test("a returning account goes straight to next", () => {
  assert.equal(afterSignInPath({ needsOnboarding: false, next: "/profile" }), "/profile");
});

test("next is re-checked here too: an absolute URL never leaves the app", () => {
  assert.equal(afterSignInPath({ needsOnboarding: false, next: "https://evil.example/x" }), "/trips");
  assert.equal(afterSignInPath({ needsOnboarding: true, next: "//evil.example" }), "/welcome");
});
