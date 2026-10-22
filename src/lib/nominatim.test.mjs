import { test } from "node:test";
import assert from "node:assert/strict";

import { nominatimPlace, parseNominatim } from "./nominatim.ts";

test("parseNominatim reads the first result's string coordinates", () => {
  assert.deepEqual(parseNominatim([{ lat: "29.5759", lon: "35.4196", name: "Wadi Rum" }, { lat: "1", lon: "2" }]), { lat: 29.5759, lon: 35.4196 });
});

test("parseNominatim is null for no results, a non-array, or unreadable coordinates", () => {
  assert.equal(parseNominatim([]), null);
  assert.equal(parseNominatim({ error: "Unable to geocode" }), null);
  assert.equal(parseNominatim([{ lat: "", lon: "35" }]), null);
  assert.equal(parseNominatim([{ lat: "95", lon: "35" }]), null);
});

test("nominatimPlace sends a User-Agent and the query, and returns the point", async () => {
  let seen;
  const fetcher = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify([{ lat: "43.07", lon: "11.67" }]), { status: 200 });
  };
  assert.deepEqual(await nominatimPlace("Val d'Orcia, Italy", fetcher), { lat: 43.07, lon: 11.67 });
  assert.match(seen.url, /q=Val%20d'Orcia%2C%20Italy/);
  assert.match(seen.init.headers["User-Agent"], /TripMate/);
});

test("nominatimPlace fails soft to null on a non-2xx or a throw", async () => {
  assert.equal(await nominatimPlace("Nowhere A", async () => new Response("busy", { status: 503 })), null);
  assert.equal(await nominatimPlace("Nowhere B", async () => { throw new Error("offline"); }), null);
});
