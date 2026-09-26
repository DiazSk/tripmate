/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/savedPlacesDb.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { deleteSavedPlace, listSavedPlaces, upsertSavedPlaces } from "./db.ts";

const owner = () => `test-owner-${randomUUID()}`;
const place = (name, extra = {}) => ({ name, lat: null, lng: null, city: "Kyoto, Japan", source: "screenshot", url: null, ...extra });

test("upsert dedupes and keeps coordinates", () => {
  const o = owner();
  upsertSavedPlaces(o, [place("Nishiki Market", { lat: 35.005, lng: 135.764 })]);
  upsertSavedPlaces(o, [place("nishiki  market!", { source: "video" })]);
  const rows = listSavedPlaces(o);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lat, 35.005);
  assert.equal(rows[0].name, "Nishiki Market");
});

test("owner isolation", () => {
  const a = owner();
  const b = owner();
  upsertSavedPlaces(a, [place("Kinkaku-ji")]);
  assert.equal(listSavedPlaces(b).length, 0);
  const [row] = listSavedPlaces(a);
  assert.equal(deleteSavedPlace(b, row.id), false);
  assert.equal(listSavedPlaces(a).length, 1);
  assert.equal(deleteSavedPlace(a, row.id), true);
  assert.equal(listSavedPlaces(a).length, 0);
});

test("instagram reminders are keyed by url and never collide with place names", () => {
  const o = owner();
  const url = "https://www.instagram.com/reel/abc/";
  upsertSavedPlaces(o, [place("Instagram post", { source: "instagram", url }), place("Instagram post", { source: "instagram", url: url + "x" })]);
  upsertSavedPlaces(o, [place("Instagram post", { source: "instagram", url })]);
  assert.equal(listSavedPlaces(o).length, 2);
});

test("list is newest first", async () => {
  const o = owner();
  upsertSavedPlaces(o, [place("First")]);
  await new Promise((r) => setTimeout(r, 5));
  upsertSavedPlaces(o, [place("Second")]);
  assert.deepEqual(listSavedPlaces(o).map((r) => r.name), ["Second", "First"]);
});
