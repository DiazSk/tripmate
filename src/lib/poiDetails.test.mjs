/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/poiDetails.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { fetchPoiOsmTags, matchElementsToPois, nameRegex, poiNameClauses } from "./poiDetails.ts";

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

// Real Overpass output, 2026-09-26: a bare node 132m off and the relation carrying the hours 6m
// off, in that order. Keeping the first match threw the Pantheon's hours away.
test("an element with opening hours beats a bare duplicate of the same place", () => {
  const PANTHEON = { name: "Pantheon", lat: 41.8986, lon: 12.4769 };
  const node = { lat: 41.8998, lon: 12.4769, tags: { name: "Pantheon" } };
  const relation = { center: { lat: 41.89865, lon: 12.47695 }, tags: { name: "Pantheon", "name:en": "Pantheon", opening_hours: "Mo-Sa 08:30-19:15; Su 09:00-17:45" } };
  assert.equal(matchElementsToPois([node, relation], [PANTHEON]).get("Pantheon"), relation);
  assert.equal(matchElementsToPois([relation, node], [PANTHEON]).get("Pantheon"), relation, "order-independent");
});

test("between two elements that both have hours, the nearer wins", () => {
  const far = { lat: 35.0162, lon: 135.7481, tags: { "name:en": "Nijo Castle", opening_hours: "FAR" } };
  const near = { center: { lat: 35.0143, lon: 135.7481 }, tags: { "name:en": "Nijo Castle", opening_hours: "NEAR" } };
  assert.equal(matchElementsToPois([far, near], [NIJO]).get("Nijo Castle"), near);
});

test("the name clause matches the local name exactly and the English name tolerantly", () => {
  const q = poiNameClauses(NIJO);
  // Two clauses, not four: `name` stays the cheap exact match it always was (local names such as
  // 二条城 match as before), and only `name:en` carries the accent- and dash-tolerant regex.
  assert.equal((q.match(/nwr\[/g) ?? []).length, 2);
  assert.ok(q.includes(`nwr["name"="Nijo Castle"](around:300,35.0142,135.7481);`));
  assert.ok(q.includes(`nwr["name:en"~"^${nameRegex("Nijo Castle")}$",i](around:300,35.0142,135.7481);`));
});

test("a name in a non-Latin script still matches itself", () => {
  // Stripping every combining mark split Hangul into jamo and dropped Thai and Devanagari vowel
  // signs, so the pattern could not match the place's own name.
  for (const n of ["경복궁", "ताज महल", "วัดโพธิ์", "ガンダムベース", "Hồ Hoàn Kiếm", "二条城"]) {
    assert.ok(new RegExp(`^${nameRegex(n)}$`, "i").test(n), n);
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

test("a website that is not plain http(s), or carries credentials, is dropped", async () => {
  const real = globalThis.fetch;
  // A different latitude per case: the result is cached by the requested POIs, so a repeat would
  // be served from the first case's row instead of the stub.
  const site = async (website, lat) => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ elements: [{ lat, lon: 135.7481, tags: { name: "Nijo Castle", website } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    return (await fetchPoiOsmTags([{ name: "Nijo Castle", lat, lon: 135.7481 }]))?.["Nijo Castle"]?.website;
  };
  try {
    assert.equal(await site("ftp://x", 10.1), null);
    assert.equal(await site("https://user:pw@x", 10.2), null);
    assert.equal(await site("https://nijo.example/", 10.3), "https://nijo.example/");
  } finally {
    globalThis.fetch = real;
  }
});
