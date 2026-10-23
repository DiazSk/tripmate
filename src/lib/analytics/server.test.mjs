/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/analytics/server.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { captureServer, requestDeletion, whoFromRequest, setAnalyticsClientForTest, setSchedulerForTest } from "./server.ts";
import { analyticsIdFor } from "./ids.ts";
import { setAnalyticsConsent } from "../db.ts";

const KEY = "phc_test";
process.env.NEXT_PUBLIC_POSTHOG_KEY = KEY;
process.env.ANALYTICS_ID_SECRET = "s3cret";
process.env.ANALYTICS_INTERNAL_USER_IDS = "user_team";
setSchedulerForTest((fn) => void fn());

const cookie = (id) => `ph_${KEY}_posthog=${encodeURIComponent(JSON.stringify({ distinct_id: id }))}`;
let sent;
const fake = { capture: (e) => sent.push(e) };
function setup() {
  sent = [];
  setAnalyticsClientForTest(fake);
}
let n = 0;
const owner = () => `owner-${++n}`;

test("no consent row sends nothing", () => {
  setup();
  captureServer({ ownerId: owner(), clerkUserId: null, cookieHeader: cookie("c1") }, "plan_written", {});
  assert.equal(sent.length, 0);
});

test("consent false sends nothing", () => {
  setup();
  const o = owner();
  setAnalyticsConsent(o, false);
  captureServer({ ownerId: o, clerkUserId: null, cookieHeader: cookie("c1") }, "plan_written", {});
  assert.equal(sent.length, 0);
});

test("consent true and a cookie sends on the cookie id, signed_in false", () => {
  setup();
  const o = owner();
  setAnalyticsConsent(o, true);
  captureServer({ ownerId: o, clerkUserId: null, cookieHeader: cookie("c1") }, "plan_written", { days: 3 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].distinctId, "c1");
  assert.equal(sent[0].event, "plan_written");
  assert.deepEqual(sent[0].properties, { days: 3, platform: "web", $geoip_disable: true, signed_in: false, internal: false });
});

test("signed in sends on the derived id, signed_in true, internal for an allowlisted user", () => {
  setup();
  const o = owner();
  setAnalyticsConsent(o, true);
  captureServer({ ownerId: o, clerkUserId: "user_team", cookieHeader: null }, "trip_kept", {});
  captureServer({ ownerId: o, clerkUserId: "user_x", cookieHeader: null }, "trip_kept", {});
  assert.equal(sent[0].distinctId, analyticsIdFor(o, "s3cret"));
  assert.equal(sent[0].properties.signed_in, true);
  assert.equal(sent[0].properties.internal, true);
  assert.equal(sent[1].properties.internal, false);
});

test("signed out with no cookie, or an over-long cookie id, sends nothing", () => {
  setup();
  const o = owner();
  setAnalyticsConsent(o, true);
  captureServer({ ownerId: o, clerkUserId: null, cookieHeader: null }, "plan_written", {});
  captureServer({ ownerId: o, clerkUserId: null, cookieHeader: cookie("x".repeat(201)) }, "plan_written", {});
  assert.equal(sent.length, 0);
});

test("unset project key turns everything off", () => {
  setup();
  const o = owner();
  setAnalyticsConsent(o, true);
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  captureServer({ ownerId: o, clerkUserId: "user_x", cookieHeader: null }, "plan_written", {});
  process.env.NEXT_PUBLIC_POSTHOG_KEY = KEY;
  assert.equal(sent.length, 0);
});

test("a throwing client never escapes", () => {
  const o = owner();
  setAnalyticsConsent(o, true);
  setAnalyticsClientForTest({ capture: () => { throw new Error("boom"); } });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => captureServer({ ownerId: o, clerkUserId: "user_x", cookieHeader: null }, "plan_written", {}));
  } finally {
    console.warn = warn;
  }
});

test("consent for another owner is not consent for this one", () => {
  setup();
  const a = owner();
  setAnalyticsConsent(a, true);
  captureServer({ ownerId: owner(), clerkUserId: null, cookieHeader: cookie("c1") }, "plan_written", {});
  assert.equal(sent.length, 0);
});

test("phone requests send nothing in phase 1", () => {
  setup();
  const o = owner();
  setAnalyticsConsent(o, true);
  captureServer({ ownerId: o, clerkUserId: "user_x", cookieHeader: null, platform: "phone" }, "plan_written", {});
  assert.equal(sent.length, 0);
});

test("whoFromRequest reads the cookie, the Clerk id, and tells the phone by its bearer token", async () => {
  const resolve = async () => ({ ownerId: "o1", clerkUserId: "user_1" });
  const web = await whoFromRequest(new Request("http://x/", { headers: { cookie: "a=b" } }), resolve);
  assert.deepEqual(web, { ownerId: "o1", clerkUserId: "user_1", cookieHeader: "a=b", platform: "web" });
  const phone = await whoFromRequest(new Request("http://x/", { headers: { authorization: "Bearer t" } }), resolve);
  assert.equal(phone.platform, "phone");
  assert.equal(phone.cookieHeader, null);
});

test("requestDeletion does nothing, and fetches nothing, without a personal key", async () => {
  delete process.env.POSTHOG_PERSONAL_API_KEY;
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return new Response("{}"); };
  try {
    await requestDeletion("c1");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetched, 0);
});

test("requestDeletion deletes only a person who owns the distinct id", async () => {
  process.env.POSTHOG_PERSONAL_API_KEY = "phx_test";
  process.env.POSTHOG_PROJECT_ID = "1";
  process.env.POSTHOG_APP_HOST = "https://eu.posthog.com/";
  const calls = [];
  const realFetch = globalThis.fetch;
  const warn = console.warn;
  console.warn = () => {};
  let people;
  globalThis.fetch = async (url, init) => {
    calls.push([String(url), init?.method ?? "GET"]);
    return calls.length === 1 || init?.method !== "DELETE"
      ? new Response(JSON.stringify({ results: people }), { status: 200 })
      : new Response(null, { status: 202 });
  };
  try {
    people = [{ id: "someone-else", distinct_ids: ["other"] }];
    await requestDeletion("c1");
    assert.deepEqual(calls.map((c) => c[1]), ["GET"]);

    calls.length = 0;
    people = [{ id: "someone-else", distinct_ids: ["other"] }, { id: "uuid-1", distinct_ids: ["x", "c1"] }];
    await requestDeletion("c1");
    assert.equal(calls[0][0], "https://eu.posthog.com/api/projects/1/persons/?distinct_id=c1");
    assert.equal(calls[1][1], "DELETE");
    assert.match(calls[1][0], /persons\/uuid-1\/\?delete_events=true/);

    globalThis.fetch = async () => { throw new Error("offline"); };
    await requestDeletion("c1");
  } finally {
    globalThis.fetch = realFetch;
    console.warn = warn;
    delete process.env.POSTHOG_APP_HOST;
  }
});
