/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/poiDetails.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { matchElementsToPois, nameRegex, poiNameClauses } from "./poiDetails.ts";

const NIJO = { name: "Nijo Castle", lat: 35.0142, lon: 135.7481 };

test("a place whose OSM name is local is found by its English name", () => {
  const el = { lat: 35.0143, lon: 135.748, tags: { name: "二条城", "name:en": "Nijo Castle", opening_hours: "Mo-Su 08:45-17:00" } };
  const m = matchElementsToPois([el], [NIJO]);
  assert.equal(m.get("Nijo Castle"), el, "filed under the requested name, not 二条城");
  assert.equal(m.size, 1);
});

test("matching ignores case and surrounding space", () => {
  const el = { lat: 35.0142, lon: 135.7481, tags: { name: "NIJO CASTLE " } };
  assert.equal(matchElementsToPois([el], [NIJO]).get("Nijo Castle"), el);
});

test("an element goes to the nearer of two same-named requests, never both", () => {
  const a = { name: "Starbucks", lat: 35.0, lon: 135.7 };
  const b = { name: "Starbucks", lat: 35.002, lon: 135.7 };
  const near = { lat: 35.0019, lon: 135.7, tags: { name: "Starbucks" } };
  const m = matchElementsToPois([near], [a, b]);
  assert.equal(m.size, 1);
  assert.equal(m.get("Starbucks"), near);
});

test("an element beyond the match radius, or matching nothing, is dropped", () => {
  const far = { lat: 35.1, lon: 135.9, tags: { name: "Nijo Castle" } };
  const other = { lat: 35.0142, lon: 135.7481, tags: { name: "Some Shop" } };
  assert.equal(matchElementsToPois([far, other], [NIJO]).size, 0);
});

test("the first matching element wins when OSM returns the place twice", () => {
  const way = { center: { lat: 35.0142, lon: 135.7481 }, tags: { name: "二条城", "name:en": "Nijo Castle", opening_hours: "A" } };
  const node = { lat: 35.0142, lon: 135.7481, tags: { "name:en": "Nijo Castle", opening_hours: "B" } };
  assert.equal(matchElementsToPois([way, node], [NIJO]).get("Nijo Castle"), way);
});

test("the name clause searches name, name:en, int_name and alt_name, case-insensitively", () => {
  const q = poiNameClauses(NIJO);
  for (const key of ["name", "name:en", "int_name", "alt_name"]) {
    assert.ok(q.includes(`nwr["${key}"~"^${nameRegex("Nijo Castle")}$",i](around:300,35.0142,135.7481);`), key);
  }
});

// OSM's name:en follows English Wikipedia: "Nijō Castle", "Fushimi Inari-taisha". A traveller
// types "Nijo Castle" and "Fushimi Inari Taisha". Both sides of the match must fold that away.
test("the name pattern ignores accents and treats a hyphen as a space", () => {
  const re = (n) => new RegExp(`^${nameRegex(n)}$`, "i");
  assert.ok(re("Nijo Castle").test("Nijō Castle"));
  assert.ok(re("Fushimi Inari Taisha").test("Fushimi Inari-taisha"));
  assert.ok(re("Musee d'Orsay").test("Musée d'Orsay"));
  assert.ok(!re("Nijo Castle").test("Nijo Castles"), "still anchored to the whole name");
});

test("matching folds accents and hyphens on the JS side too", () => {
  const el = { lat: 35.0142, lon: 135.7481, tags: { name: "二条城", "name:en": "Nijō Castle", opening_hours: "Mo-Su 08:45-17:00" } };
  assert.equal(matchElementsToPois([el], [NIJO]).get("Nijo Castle"), el);
  const fushimi = { lat: 34.9671, lon: 135.7727, tags: { name: "伏見稲荷大社", "name:en": "Fushimi Inari-taisha" } };
  const req = { name: "Fushimi Inari Taisha", lat: 34.9671, lon: 135.7727 };
  assert.equal(matchElementsToPois([fushimi], [req]).get("Fushimi Inari Taisha"), fushimi);
});

test("quotes and parentheses in a name cannot break the query", () => {
  const q = poiNameClauses({ name: `St. Peter's "Basilica" (Vatican)`, lat: 41.9, lon: 12.45 });
  const value = nameRegex(`St. Peter's "Basilica" (Vatican)`);
  for (const esc of ["\\.", '\\"', "\\(", "\\)"]) assert.ok(value.includes(esc), esc);
  // Inside each ~"…" the only unescaped quotes are the two delimiters.
  for (const m of q.matchAll(/~"(.*?[^\\])"/g)) assert.ok(!/[^\\]"/.test(m[1]), m[1]);
  assert.ok(new RegExp(`^${value}$`, "i").test(`St. Peter's "Basilica" (Vatican)`), "still matches the name itself");
});
