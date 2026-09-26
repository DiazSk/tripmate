/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/savedPlaces.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { parseSavedPlacesBody } from "./savedPlaces.ts";

test("accepts places with a city and a source", () => {
  const out = parseSavedPlacesBody({ places: [{ name: " Kinkaku-ji ", lat: 35.04, lng: 135.73 }], city: "Kyoto, Japan", source: "screenshot" });
  assert.deepEqual(out, { rows: [{ name: "Kinkaku-ji", lat: 35.04, lng: 135.73, city: "Kyoto, Japan", source: "screenshot", url: null }] });
});

test("rejects an unknown source, a non-array, and over 40 places", () => {
  assert.ok("error" in parseSavedPlacesBody({ places: [], source: "fax" }));
  assert.ok("error" in parseSavedPlacesBody({ places: "x", source: "text" }));
  assert.ok("error" in parseSavedPlacesBody({ places: Array.from({ length: 41 }, (_, i) => ({ name: `P${i}` })), source: "text" }));
});

test("drops blank or oversized names and non-numeric coordinates", () => {
  const out = parseSavedPlacesBody({ places: [{ name: "" }, { name: "x".repeat(121) }, { name: "Ok", lat: "1", lng: 2 }], source: "text" });
  assert.deepEqual(out.rows, [{ name: "Ok", lat: null, lng: 2, city: null, source: "text", url: null }]);
});

test("an instagram reminder needs an instagram https url and gets a default name", () => {
  assert.ok("error" in parseSavedPlacesBody({ places: [], source: "instagram", url: "http://evil.test/x" }));
  const out = parseSavedPlacesBody({ places: [], source: "instagram", url: "https://www.instagram.com/reel/abc/" });
  assert.deepEqual(out.rows, [{ name: "Instagram post", lat: null, lng: null, city: null, source: "instagram", url: "https://www.instagram.com/reel/abc/" }]);
});
