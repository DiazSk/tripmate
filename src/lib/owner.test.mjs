import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEGACY_OWNER,
  OWNER_COOKIE,
  OWNER_COOKIE_MAX_AGE_S,
  isValidOwnerId,
  newOwnerId,
  readableOwners,
  resolveOwnerId,
} from "./owner.ts";
import { DRAFT_TTL_DAYS } from "./drafts.ts";

describe("owner ids", () => {
  it("mints a distinct id each time", () => {
    const a = newOwnerId();
    const b = newOwnerId();
    assert.notEqual(a, b);
    assert.ok(isValidOwnerId(a));
  });

  it("accepts a UUID in either case, and the legacy bucket", () => {
    assert.ok(isValidOwnerId("3f2504e0-4f89-41d3-9a0c-0305e82c3301"));
    assert.ok(isValidOwnerId("3F2504E0-4F89-41D3-9A0C-0305E82C3301"));
    assert.ok(isValidOwnerId(LEGACY_OWNER));
  });

  it("rejects anything it did not mint", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "   ",
      "not-a-uuid",
      "3f2504e0-4f89-41d3-9a0c",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301x",
      // The reason validation exists at all: a junk value must not become a real, distinct owner
      // and silently hand the sender an empty drafts list.
      "'; DROP TABLE trips;--",
    ]) {
      assert.equal(isValidOwnerId(bad), false, JSON.stringify(bad));
    }
  });
});

describe("resolveOwnerId", () => {
  it("passes a valid cookie through", () => {
    const id = newOwnerId();
    assert.equal(resolveOwnerId(id), id);
  });

  // This is what keeps curl, the perf scripts and the bench harness working unchanged — they
  // never send a cookie and must keep seeing what they saw before ownership existed.
  it("falls back to the legacy bucket for a missing or junk cookie", () => {
    assert.equal(resolveOwnerId(undefined), LEGACY_OWNER);
    assert.equal(resolveOwnerId(null), LEGACY_OWNER);
    assert.equal(resolveOwnerId("garbage"), LEGACY_OWNER);
  });
});

describe("readableOwners", () => {
  it("lets a browser read its own rows and the pre-ownership ones", () => {
    const id = newOwnerId();
    assert.deepEqual(readableOwners(id), [id, LEGACY_OWNER]);
  });

  it("does not ask for the legacy bucket twice", () => {
    assert.deepEqual(readableOwners(LEGACY_OWNER), [LEGACY_OWNER]);
  });

  it("never lets one browser read another's rows", () => {
    const a = newOwnerId();
    const b = newOwnerId();
    assert.equal(readableOwners(a).includes(b), false);
  });
});

describe("cookie lifetime", () => {
  it("outlives the drafts it identifies", () => {
    // The identity has to survive longer than the thing it identifies. A cookie that expired
    // first would orphan a traveler from drafts still well inside their own retention window.
    const draftTtlSeconds = DRAFT_TTL_DAYS * 24 * 60 * 60;
    assert.ok(
      OWNER_COOKIE_MAX_AGE_S > draftTtlSeconds,
      `cookie lives ${OWNER_COOKIE_MAX_AGE_S}s but drafts live ${draftTtlSeconds}s`
    );
  });

  it("stays within the 400-day ceiling browsers clamp Max-Age to", () => {
    assert.ok(OWNER_COOKIE_MAX_AGE_S <= 400 * 24 * 60 * 60);
  });

  it("names the cookie something scoped to this app", () => {
    assert.match(OWNER_COOKIE, /^tripmate_/);
  });
});
