/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/clerkError.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { clerkMessage } from "./clerkError.ts";

test("prefers Clerk's long message from an API error", () => {
  assert.equal(
    clerkMessage({ errors: [{ message: "Incorrect", longMessage: "Password is incorrect. Try again." }] }),
    "Password is incorrect. Try again.",
  );
});

test("falls back to the short message, then to the error's own message", () => {
  assert.equal(clerkMessage({ errors: [{ message: "Incorrect" }] }), "Incorrect");
  assert.equal(clerkMessage({ longMessage: "Too many tries." }), "Too many tries.");
  assert.equal(clerkMessage(new Error("Network down")), "Network down");
});

test("anything else reads as the fallback", () => {
  assert.equal(clerkMessage(null), "That didn't work. Try again.");
  assert.equal(clerkMessage({}, "Custom"), "Custom");
});
