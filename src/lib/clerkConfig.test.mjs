import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clerkConfigured } from "./clerkConfig.ts";

const SECRET = "CLERK_SECRET_KEY";
const PUBLISHABLE = "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY";

describe("clerkConfigured", () => {
  it("is true only when both keys are present", () => {
    assert.equal(clerkConfigured({ [SECRET]: "sk_test_x", [PUBLISHABLE]: "pk_test_x" }), true);
  });

  it("is false when either key is missing", () => {
    assert.equal(clerkConfigured({ [SECRET]: "sk_test_x" }), false);
    assert.equal(clerkConfigured({ [PUBLISHABLE]: "pk_test_x" }), false);
    assert.equal(clerkConfigured({}), false);
  });

  it("treats an empty string as missing", () => {
    assert.equal(clerkConfigured({ [SECRET]: "", [PUBLISHABLE]: "pk_test_x" }), false);
    assert.equal(clerkConfigured({ [SECRET]: "sk_test_x", [PUBLISHABLE]: "" }), false);
  });
});
