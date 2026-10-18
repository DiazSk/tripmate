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
  writableOwners,
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

  it("never shows a signed-in account the shared legacy bucket", () => {
    // The legacy bucket holds every pre-ownership row and is readable by anyone who asks. Widening
    // an account's reads into it would put the whole app's history on one person's memories wall.
    const id = newOwnerId();
    assert.deepEqual(readableOwners(id, true), [id]);
  });

  it("still widens for anonymous visitors, which is the migration affordance", () => {
    const id = newOwnerId();
    assert.deepEqual(readableOwners(id, false), [id, LEGACY_OWNER]);
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

describe("writes are never widened", () => {
  const someone = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  // The regression this function exists for. `readableOwners` returns the caller *plus* the
  // legacy bucket, and both PATCH and DELETE on /api/trips/[id] used it — so a caller with any
  // valid cookie could write any row that predates ownership. Measured against a running server
  // before the fix: PATCH emptied a legacy-owned itinerary to zero days, DELETE removed it.
  it("does not hand a caller the legacy bucket", () => {
    assert.deepEqual(writableOwners(someone), [someone]);
    assert.ok(!writableOwners(someone).includes(LEGACY_OWNER));
    // The read rule is unchanged and still widens — the two must not converge by accident.
    assert.ok(readableOwners(someone).includes(LEGACY_OWNER));
  });

  it("is exactly one owner, for every caller", () => {
    for (const id of [someone, LEGACY_OWNER, newOwnerId()]) {
      assert.equal(writableOwners(id).length, 1);
      assert.equal(writableOwners(id)[0], id);
    }
  });

  // Stated as a test because it is the limit of what this layer can do, and a future reader
  // should meet it here rather than conclude the bucket is protected. A cookieless caller
  // resolves to LEGACY_OWNER and so matches a legacy row exactly; what protects those rows is
  // that their ids are no longer handed out, not this function.
  it("still matches a legacy row for a cookieless caller, which is inherent", () => {
    assert.ok(writableOwners(resolveOwnerId(undefined)).includes(LEGACY_OWNER));
  });
});

// Production has no shared bucket. `env` is passed explicitly so these run under `node --test`,
// where NODE_ENV is unset and the dev behaviour above is what applies.
describe("the legacy bucket in production", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it("is not a valid owner id in production, and still is in development", () => {
    assert.equal(isValidOwnerId(LEGACY_OWNER, "production"), false);
    assert.equal(isValidOwnerId(LEGACY_OWNER, "development"), true);
    assert.equal(isValidOwnerId(newOwnerId(), "production"), true);
  });

  it("is never widened into a read in production", () => {
    const id = newOwnerId();
    assert.deepEqual(readableOwners(id, false, "production"), [id]);
    assert.deepEqual(readableOwners(id, false, "development"), [id, LEGACY_OWNER]);
  });

  it("is replaced by a fresh owner when a request carries none", () => {
    const a = resolveOwnerId(undefined, "production");
    assert.match(a, UUID);
    assert.notEqual(a, LEGACY_OWNER);
    assert.notEqual(resolveOwnerId("local", "production"), LEGACY_OWNER);
    assert.equal(resolveOwnerId(undefined, "development"), LEGACY_OWNER);
  });
});
