/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/photon.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_DISTANCE_KM, photonArea, pickHit } from "./photon.ts";

const MUMBAI = { lat: 19.076, lon: 72.8777 };
const feature = (lng, lat, properties) => ({ geometry: { coordinates: [lng, lat] }, properties });

test("pickHit skips a same-named place in another city and takes the first one nearby", () => {
  const hit = pickHit("Leopold Cafe", [
    feature(4.3601, 50.8314, { name: "Leopold Cafe Presse", city: "Ixelles" }), // Brussels
    feature(72.8318, 18.9227, { name: "Leopold Cafe", locality: "Apollo Bandar", district: "A Ward" }),
  ], MUMBAI);
  assert.deepEqual(hit, { lat: 18.9227, lng: 72.8318, area: "Apollo Bandar" });
});

test("pickHit returns undefined when every hit is beyond the radius", () => {
  // Kochi's Marine Drive, ~1,000km south.
  assert.equal(pickHit("Marine Drive", [feature(76.2789, 9.9816, { name: "Marine Drive" })], MUMBAI), undefined);
  assert.ok(MAX_DISTANCE_KM >= 30 && MAX_DISTANCE_KM <= 100);
});

test("photonArea names the match when it differs from what was typed, then the locality", () => {
  assert.equal(
    photonArea("Colaba Causeway", { name: "Nanabhai Moos Marg (Upper Colaba Road)", locality: "Apollo Bandar", district: "A Ward" }),
    "Nanabhai Moos Marg (Upper Colaba Road), Apollo Bandar"
  );
  assert.equal(photonArea("marine drive", { name: "Marine Drive", locality: "Girgaon", district: "D Ward" }), "Girgaon");
  assert.equal(photonArea("X", { name: "X", district: "A Ward" }), "A Ward");
  assert.equal(photonArea("X", { name: "X" }), undefined);
});

test("pickHit never counts a city, county, state or country as the place", () => {
  const hit = pickHit("Mumbai food", [
    feature(72.8777, 19.076, { name: "Mumbai", type: "city" }),
    feature(72.83, 18.92, { name: "Mumbai Food Court", type: "house", locality: "Colaba" }),
  ], MUMBAI);
  assert.deepEqual(hit, { lat: 18.92, lng: 72.83, area: "Mumbai Food Court, Colaba" });
  assert.equal(pickHit("Maharashtra", [feature(75.7, 19.6, { name: "Maharashtra", type: "state" })], MUMBAI), undefined);
});
