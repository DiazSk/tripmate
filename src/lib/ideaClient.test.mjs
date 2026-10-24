/* Run: npm test (needs --import ./scripts/ts-resolve.mjs, since ideaClient.ts imports failure.ts extensionless) */
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { ideaFailureCopy, loadReadyTrips, readIdea, understoodNothing } from "./ideaClient.ts";
import { formatResumeTime } from "./failure.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (status, body) => new Response(JSON.stringify(body), { status });

test("ideaFailureCopy: every branch says its row", () => {
  const rate = { kind: "rate_limited", bucket: "idea", retryAfterSeconds: 600, limit: 20, windowMinutes: 10 };
  assert.equal(
    ideaFailureCopy(rate),
    "You’ve asked Meri to read 20 trip ideas in the last 10 minutes, which is the limit. You can ask again in about 10 minutes.",
  );
  assert.match(
    ideaFailureCopy({ ...rate, limit: 30, windowMinutes: 15 }),
    /^You’ve asked Meri to read 30 trip ideas in the last 15 minutes, which is the limit\./,
  );
  assert.match(ideaFailureCopy({ ...rate, limit: 0, windowMinutes: 0 }), /read 20 trip ideas in the last 10 minutes/);
  assert.match(ideaFailureCopy({ ...rate, retryAfterSeconds: 5 }), /in about 1 minute\.$/);
  assert.equal(
    ideaFailureCopy({ kind: "timeout" }),
    "Reading your idea took longer than TripMate allows, so it stopped. Try again.",
  );
  assert.equal(ideaFailureCopy({ kind: "refused", message: "Only trips." }), "Only trips.");
  assert.equal(ideaFailureCopy({ kind: "invalid", message: "Say more." }), "Say more.");
  assert.equal(ideaFailureCopy({ kind: "offline" }), "Meri can read your idea when you’re back online.");
  const at = new Date(Date.now() + 3_600_000);
  assert.equal(
    ideaFailureCopy({ kind: "daily_cap", resumesAt: at }),
    `Meri is paused for everyone until ${formatResumeTime(at)}. TripMate has reached its limit for the day; it isn’t anything you did. You can still plan step by step.`,
  );
  for (const kind of ["server", "not_found", "signed_out"]) {
    assert.equal(ideaFailureCopy({ kind }), "Couldn’t read that idea. Try again, or plan it step by step.");
  }
});

const none = { destination: null, kind: null, days: null, budget: null, budgetBasis: null, adults: null, children: null, pace: null, interests: [], tags: [], avoidTags: [] };

test("understoodNothing needs a destination, kind or days", () => {
  assert.equal(understoodNothing(none), true);
  assert.equal(understoodNothing({ ...none, kind: "somewhere warm" }), false);
  assert.equal(understoodNothing({ ...none, destination: "Lisbon, Portugal" }), false);
  assert.equal(understoodNothing({ ...none, days: 4 }), false);
  assert.equal(understoodNothing({ ...none, budget: 2000 }), true);
});

test("readIdea posts the idea and maps the outcomes", async () => {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return json(200, none);
  };
  const ok = await readIdea("4 days in Lisbon");
  assert.equal(seen.url, "/api/read-idea");
  assert.equal(seen.init.method, "POST");
  assert.deepEqual(JSON.parse(seen.init.body), { idea: "4 days in Lisbon" });
  assert.deepEqual(ok, { ok: true, read: none });

  globalThis.fetch = async () => json(429, { code: "rate_limited", retryAfterSeconds: 120 });
  const limited = await readIdea("x");
  assert.equal(limited.ok, false);
  assert.deepEqual([limited.failure.kind, limited.failure.bucket], ["rate_limited", "idea"]);

  globalThis.fetch = async () => {
    throw new DOMException("cancelled", "AbortError");
  };
  assert.deepEqual(await readIdea("x"), { ok: false, aborted: true });

  globalThis.fetch = async () => {
    throw new Error("boom");
  };
  assert.deepEqual(await readIdea("x"), { ok: false, failure: { kind: "server" } });
});

test("loadReadyTrips: failures are [] and not cached, a success is cached", async () => {
  let calls = 0;
  const stub = (fn) => {
    globalThis.fetch = async () => {
      calls++;
      return fn();
    };
  };
  stub(() => json(200, { available: false, trips: [] }));
  assert.deepEqual(await loadReadyTrips(), []);
  stub(() => {
    throw new Error("offline");
  });
  assert.deepEqual(await loadReadyTrips(), []);
  stub(() => json(500, {}));
  assert.deepEqual(await loadReadyTrips(), []);
  assert.equal(calls, 3);

  const t = { slug: "petra" };
  stub(() => json(200, { available: true, trips: [t] }));
  assert.deepEqual(await loadReadyTrips(), [t]);
  assert.deepEqual(await loadReadyTrips(), [t]);
  assert.equal(calls, 4);
});
