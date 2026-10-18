/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/clerkError.test.mjs */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { clerkMessage, unsupportedStepMessage, SIGN_IN_OFFLINE, SIGN_IN_UNEXPLAINED } from "./clerkError.ts";

// unsupportedStepMessage warns for developers; keep that out of the test output.
test.beforeEach(() => mock.method(console, "warn", () => {}));
test.afterEach(() => mock.restoreAll());

test("prefers Clerk's long message from an API error", () => {
  assert.equal(
    clerkMessage({ errors: [{ message: "Incorrect", longMessage: "Password is incorrect. Try again." }] }),
    "Password is incorrect. Try again.",
  );
});

test("falls back to the short message, then to the error's long message", () => {
  assert.equal(clerkMessage({ errors: [{ message: "Incorrect" }] }), "Incorrect");
  assert.equal(clerkMessage({ longMessage: "Too many tries." }), "Too many tries.");
});

test("a bare thrown error's own message is never shown", () => {
  assert.equal(clerkMessage(new TypeError("Failed to fetch"), true), SIGN_IN_UNEXPLAINED);
  assert.equal(clerkMessage(new TypeError("Failed to fetch"), false), SIGN_IN_OFFLINE);
});

test("nothing readable says offline when offline, and that the service gave no reason otherwise", () => {
  assert.equal(clerkMessage(null, true), SIGN_IN_UNEXPLAINED);
  assert.equal(clerkMessage({}, false), SIGN_IN_OFFLINE);
});

test("a sign-up stuck on fields TripMate doesn't collect names them", () => {
  assert.equal(
    unsupportedStepMessage({ status: "missing_requirements", missingFields: ["username"] }),
    "TripMate can't finish this sign-up: it also needs a username, which the app doesn't ask for yet.",
  );
  assert.equal(
    unsupportedStepMessage({ status: "missing_requirements", missingFields: ["username", "phone_number", "legal_accepted"] }),
    "TripMate can't finish this sign-up: it also needs a username, a phone number and acceptance of the terms, which the app doesn't ask for yet.",
  );
});

test("an unknown field is named plainly rather than dropped", () => {
  assert.match(unsupportedStepMessage({ status: "missing_requirements", missingFields: ["web3_wallet"] }), /web3 wallet/);
});

test("a second factor is called what it is", () => {
  assert.equal(
    unsupportedStepMessage({ status: "needs_second_factor" }),
    "This account uses two-step verification, which TripMate doesn't support yet.",
  );
});

test("anything else keeps the general sentence", () => {
  assert.equal(unsupportedStepMessage({ status: "needs_identifier" }), "This account needs a sign-in step TripMate doesn't support yet.");
  assert.equal(unsupportedStepMessage({ status: "missing_requirements", missingFields: [] }), "This account needs a sign-in step TripMate doesn't support yet.");
});
