/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/analytics/client.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";

/*
 * The consent state machine in client.ts, against a fake posthog-js and a fake server. Each test
 * imports a fresh copy of the module (its state is module-level), with the browser globals it
 * touches stubbed: storage, `location`, `window` events and `fetch`.
 */

process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function fakePosthog() {
  const calls = [];
  let optedOut = false;
  const p = {
    calls,
    sessionCb: null,
    init(_key, opts) {
      calls.push(["init"]);
      opts.loaded?.(p);
    },
    register: (props) => calls.push(["register", props]),
    register_once: () => {},
    has_opted_out_capturing: () => optedOut,
    opt_in_capturing: () => {
      optedOut = false;
      calls.push(["opt_in"]);
    },
    opt_out_capturing: () => {
      optedOut = true;
      calls.push(["opt_out"]);
    },
    startSessionRecording: () => calls.push(["start_rec"]),
    stopSessionRecording: () => calls.push(["stop_rec"]),
    capture: (event) => calls.push(["capture", event]),
    identify: (id) => calls.push(["identify", id]),
    setPersonProperties: (set, once) => calls.push(["set", set, once]),
    reset: () => calls.push(["reset"]),
    onSessionId(cb) {
      p.sessionCb = cb;
      return () => {};
    },
    names: () => calls.map((c) => c[0]),
    isOptedOut: () => optedOut,
  };
  return p;
}

/** The server: `stored` is what GET consent answers, `postOk` whether a POST lands, `id` the id route's body. */
function fakeServer(state) {
  return async (url, init) => {
    const u = String(url);
    if (u === "/api/analytics/consent" && init?.method === "POST") {
      if (!state.postOk) throw new TypeError("Failed to fetch");
      state.stored = JSON.parse(init.body).consent;
      return new Response(null, { status: 204 });
    }
    if (u === "/api/analytics/consent") return Response.json({ consent: state.stored });
    if (u === "/api/analytics/id") return Response.json(state.id ?? { id: "derived-1", internal: false });
    throw new Error(`unexpected fetch ${u}`);
  };
}

let n = 0;
async function load(state, { gate } = {}) {
  globalThis.localStorage = memoryStorage();
  globalThis.sessionStorage = memoryStorage();
  globalThis.location = { search: "", pathname: "/" };
  globalThis.window = new EventTarget();
  globalThis.fetch = fakeServer(state);
  const ph = fakePosthog();
  const client = await import(`./client.ts?case=${++n}`);
  client.setSdkLoaderForTest(() => (gate ? gate.then(() => ph) : Promise.resolve(ph)));
  return { client, ph };
}

const settle = () => new Promise((r) => setTimeout(r, 5));
const account = { id: "user_1", name: "Ana", email: "ana@example.com" };

test("a No pressed while the SDK is still importing stops the init", async () => {
  let open;
  const gate = new Promise((r) => (open = r));
  const state = { stored: true, postOk: true };
  const { client, ph } = await load(state, { gate });
  const started = client.applyStoredConsent(true);
  await client.setConsent(false);
  open();
  await started;
  await settle();
  assert.equal(ph.names().includes("init"), false);
  client.track("plan_started");
  assert.equal(ph.names().includes("capture"), false);
});

test("a No that did not save keeps capture off and throws, so the switch can say so", async () => {
  const state = { stored: true, postOk: false };
  const { client, ph } = await load(state);
  await client.applyStoredConsent(true);
  await assert.rejects(client.setConsent(false));
  assert.equal(ph.isOptedOut(), true);
  assert.equal(ph.names().includes("opt_in"), false);
  // And nobody is identified on a page that said No.
  client.setAccount(account);
  await settle();
  assert.equal(ph.names().includes("identify"), false);
});

test("sign-in identifies only after the account's own stored answer reads Yes, and marks an internal person", async () => {
  const state = { stored: true, postOk: true, id: { id: "derived-1", internal: true } };
  const { client, ph } = await load(state);
  await client.applyStoredConsent(true);
  client.setAccount(account);
  await settle();
  assert.deepEqual(ph.calls.find((c) => c[0] === "identify"), ["identify", "derived-1"]);
  const set = ph.calls.find((c) => c[0] === "set" && c[1]?.email);
  assert.deepEqual(set[1], { name: "Ana", email: "ana@example.com", internal: true });
});

test("sign-in where the account holds a No: never identified, capture stops", async () => {
  const state = { stored: true, postOk: true };
  const { client, ph } = await load(state);
  await client.applyStoredConsent(true);
  state.stored = false; // the account's answer, read after the claim
  client.setAccount(account);
  await settle();
  assert.equal(ph.names().includes("identify"), false);
  assert.equal(ph.isOptedOut(), true);
});

test("sign-in where the account has no answer yet: not identified until a Yes is read", async () => {
  const state = { stored: true, postOk: true };
  const { client, ph } = await load(state);
  await client.applyStoredConsent(true);
  state.stored = null;
  client.setAccount(account);
  await settle();
  assert.equal(ph.names().includes("identify"), false);
  state.stored = true;
  await client.identifyAfterSignIn();
  await settle();
  assert.equal(ph.names().includes("identify"), true);
});

test("sign-out resets even when the account was never identified, and resumes only on a stored Yes", async () => {
  const state = { stored: true, postOk: true };
  const { client, ph } = await load(state);
  await client.applyStoredConsent(true);
  state.stored = null;
  client.setAccount(account); // not identified: the read says no answer
  await settle();
  state.stored = true; // the device's own owner said Yes
  client.setAccount(null);
  await settle();
  const names = ph.names();
  assert.ok(names.includes("reset"), "reset on sign-out");
  assert.ok(names.lastIndexOf("opt_out") < names.lastIndexOf("opt_in"), "resumed after the stored Yes");
});

test("sign-out with no stored Yes stays opted out", async () => {
  const state = { stored: true, postOk: true };
  const { client, ph } = await load(state);
  await client.applyStoredConsent(true);
  client.setAccount(account);
  await settle();
  state.stored = null;
  client.setAccount(null);
  await settle();
  assert.ok(ph.names().includes("reset"));
  assert.equal(ph.isOptedOut(), true);
});

test("third_session fires once, on the third distinct PostHog session this browser has seen", async () => {
  const state = { stored: true, postOk: true };
  const { client, ph } = await load(state);
  await client.applyStoredConsent(true);
  for (const sid of ["s1", "s1", "s2", "s3", "s3", "s4"]) ph.sessionCb(sid, "w");
  assert.equal(ph.calls.filter((c) => c[0] === "capture" && c[1] === "third_session").length, 1);
});
