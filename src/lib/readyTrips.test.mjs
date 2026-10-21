import assert from "node:assert/strict";
import test from "node:test";
import { fetchReadyTrips, parseReadyTrips, sanityConfig } from "./readyTrips.ts";

const petra = {
  slug: "petra-at-first-light",
  title: "Petra at first light",
  destination: "Petra, Jordan",
  monument: "PETRA",
  days: 3,
  priceFrom: 1450,
  tags: ["Desert", "History"],
  featured: true,
  itinerary: [{ day: 1, theme: "The Siq at first light", stops: [{ name: "The Siq", kind: "walk", note: "Go early." }, { kind: "food" }] }],
};

test("no read token, no Sanity: the catalogue is unavailable, not empty", async () => {
  assert.equal(sanityConfig({}), null);
  assert.equal(await fetchReadyTrips(null), null);
  assert.deepEqual(sanityConfig({ SANITY_API_READ_TOKEN: " sk " }), { projectId: "zj8wtfx1", dataset: "production", token: "sk" });
});

test("a document a card cannot draw is dropped; a nameless stop is dropped from its day", () => {
  const trips = parseReadyTrips([petra, { slug: "no-monument", days: 2 }, { monument: "X", days: 2 }, null]);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].monument, "PETRA");
  assert.deepEqual(trips[0].itinerary[0].stops.map((s) => s.name), ["The Siq"]);
  assert.deepEqual(parseReadyTrips("nope"), []);
});

test("the token rides in a header, never the URL, and a refusal reads as unavailable", async () => {
  const seen = [];
  const ok = async (url, init) => {
    seen.push({ url, auth: init.headers.Authorization });
    return { ok: true, json: async () => ({ result: [petra] }) };
  };
  const trips = await fetchReadyTrips({ projectId: "test-ok", dataset: "production", token: "secret" }, ok);
  assert.equal(trips.length, 1);
  assert.equal(seen[0].auth, "Bearer secret");
  assert.ok(!seen[0].url.includes("secret"), "token must not appear in the URL");
  assert.ok(seen[0].url.startsWith("https://test-ok.api.sanity.io/"));

  const refused = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await fetchReadyTrips({ projectId: "test-401", dataset: "production", token: "bad" }, refused), null);
  const down = async () => {
    throw new Error("ECONNRESET");
  };
  assert.equal(await fetchReadyTrips({ projectId: "test-down", dataset: "production", token: "t" }, down), null);
});
