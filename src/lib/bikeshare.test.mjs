/* Run: node --test src/lib/bikeshare.test.mjs
 *
 * `bikeshare.ts` is mostly parsers, and parsers are where this feature can lie. `npm test` reaches
 * no network, so `fetchBikeshare` itself is untestable here — the same split `destinationSafety`
 * makes, where `distilSafetyNotes` is tested and `fetchSafetyNotes` never is.
 *
 * **The pricing and vehicle-type fixtures below are real payload shapes, captured from live feeds
 * while designing this.** That matters more than usual: GBFS's published spec and GBFS's actual
 * output disagree, and a test written against the spec would pass while the module quietly
 * mis-priced a trip. Every odd-looking case here — a price of 0, a price as a string, a fare
 * buried in a plan's name, a car-share in a bikeshare catalog — is something an operator really
 * publishes.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  countPhysicalDocksWithin,
  countStationsWithin,
  hasBicycleForm,
  matchCandidates,
  normalizeLocation,
  parseSystemsCsv,
  readDayPass,
  readFeedUrls,
  readStations,
} from "./bikeshare.ts";

const HEADER =
  "Country Code,Name,Location,System ID,URL,Auto-Discovery URL,Supported Versions,Authentication Info URL,Authentication Type,Authentication Parameter Name";

const row = (cells) => cells.join(",");

test("parseSystemsCsv reads a normal row", () => {
  const csv = `${HEADER}\n${row(["CA", "Bike Share Toronto", "Toronto", "bike_share_toronto", "https://x", "https://t/gbfs.json", "3.0", "", "", ""])}`;
  const rows = parseSystemsCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].countryCode, "CA");
  assert.equal(rows[0].location, "Toronto");
  assert.equal(rows[0].autoDiscoveryUrl, "https://t/gbfs.json");
});

test("parseSystemsCsv keeps a quoted field containing a comma", () => {
  // Real: Capital Bikeshare's Location is "Washington, DC". A split(",") shifts every later column.
  const csv = `${HEADER}\nUS,Capital Bike Share,"Washington, DC",capital_bikeshare,https://x,https://c/gbfs.json,2.3,,,`;
  const rows = parseSystemsCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].location, "Washington, DC");
  assert.equal(rows[0].systemId, "capital_bikeshare", "columns after the quoted field must not shift");
  assert.equal(rows[0].autoDiscoveryUrl, "https://c/gbfs.json");
});

test("parseSystemsCsv tolerates CRLF and a trailing blank line", () => {
  const csv = `${HEADER}\r\nCA,A,Toronto,a,https://x,https://a/gbfs.json,3.0,,,\r\n\r\n`;
  assert.equal(parseSystemsCsv(csv).length, 1);
});

test("parseSystemsCsv drops an unusable row rather than throwing", () => {
  // No auto-discovery URL: nothing can be fetched, so the row is noise, not an error.
  const csv = `${HEADER}\nCA,A,Toronto,a,https://x,,3.0,,,\nCA,B,Montreal,b,https://y,https://b/gbfs.json,3.0,,,`;
  const rows = parseSystemsCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].location, "Montreal");
});

test("parseSystemsCsv returns [] for junk instead of throwing", () => {
  assert.deepEqual(parseSystemsCsv(""), []);
  assert.deepEqual(parseSystemsCsv("not,a,known,header\n1,2,3,4"), []);
});

test("normalizeLocation strips diacritics, case and punctuation", () => {
  assert.equal(normalizeLocation("Zürich"), "zurich");
  assert.equal(normalizeLocation("Malmö"), "malmo");
  assert.equal(normalizeLocation("Washington, DC"), "washington dc");
  assert.equal(normalizeLocation("  Saint-Étienne  "), "saint etienne");
});

const catalog = [
  { name: "Bicing", countryCode: "ES", location: "Barcelona", systemId: "bicing", autoDiscoveryUrl: "https://b", authType: "" },
  { name: "Citi Bike", countryCode: "US", location: "New York", systemId: "citi", autoDiscoveryUrl: "https://c", authType: "" },
  { name: "Other NYC", countryCode: "US", location: "New York City", systemId: "nyc2", autoDiscoveryUrl: "https://n", authType: "" },
  { name: "DB", countryCode: "DE", location: "Hamburg", systemId: "db", autoDiscoveryUrl: "https://d", authType: "DB-Client-Id|DB-Api-Key" },
];

test("matchCandidates filters by country before comparing names", () => {
  // The Cambridge problem: same city name, different country. The country filter removes the whole
  // class of error before name matching is asked to be clever.
  const rows = [
    ...catalog,
    { name: "UK thing", countryCode: "GB", location: "Barcelona", systemId: "uk", autoDiscoveryUrl: "https://u", authType: "" },
  ];
  const found = matchCandidates(rows, { name: "Barcelona", countryCode: "ES" });
  assert.equal(found.length, 1);
  assert.equal(found[0].systemId, "bicing");
});

test("matchCandidates ranks an exact match ahead of a partial one", () => {
  const found = matchCandidates(catalog, { name: "New York", countryCode: "US" });
  assert.equal(found[0].systemId, "citi", "exact 'New York' must outrank 'New York City'");
});

test("matchCandidates skips a feed that needs an API key", () => {
  assert.deepEqual(matchCandidates(catalog, { name: "Hamburg", countryCode: "DE" }), []);
});

test("matchCandidates returns [] when nothing matches or the country is unknown", () => {
  assert.deepEqual(matchCandidates(catalog, { name: "Sinaia", countryCode: "RO" }), []);
  assert.deepEqual(matchCandidates(catalog, { name: "Barcelona", countryCode: null }), []);
});

test("matchCandidates does not match a substring of a longer word", () => {
  const rows = [{ name: "Y", countryCode: "GB", location: "Yorkshire", systemId: "y", autoDiscoveryUrl: "https://y", authType: "" }];
  assert.deepEqual(matchCandidates(rows, { name: "York", countryCode: "GB" }), []);
});

const paris = { lat: 48.8566, lon: 2.3522 };

test("countStationsWithin counts by real distance, not bounding box", () => {
  const stations = [
    { lat: 48.8566, lon: 2.3522, capacity: 20, virtual: false }, // same point
    { lat: 48.87, lon: 2.35, capacity: 15, virtual: false }, // ~1.5km
    { lat: 49.2, lon: 2.35, capacity: 15, virtual: false }, // ~38km, well outside
  ];
  assert.equal(countStationsWithin(stations, paris, 15), 2);
  assert.equal(countStationsWithin(stations, paris, 50), 3);
  assert.equal(countStationsWithin([], paris, 15), 0);
});

test("countStationsWithin ignores zero-capacity zones — the scooter-fleet guard", () => {
  // Real: Dott Paris publishes 13,206 "stations" with no capacity field at all — free-floating
  // parking zones, not docks. Before this filter, Paris resolved to Dott instead of Vélib', and
  // the wrong answer looked more authoritative for having the bigger number.
  const dottZones = Array.from({ length: 50 }, () => ({ lat: 48.857, lon: 2.353, capacity: 0, virtual: true }));
  assert.equal(countStationsWithin(dottZones, paris, 15), 0);

  const mixed = [...dottZones, { lat: 48.857, lon: 2.353, capacity: 30, virtual: false }];
  assert.equal(countStationsWithin(mixed, paris, 15), 1);
});

test("countPhysicalDocksWithin separates Vélib' from a scooter fleet", () => {
  // The measured shapes, reduced: Vélib' publishes physical docks with capacities of 21-60 and
  // is_virtual_station absent; Voi Paris publishes 13,065 virtual bays with capacities of 1-8.
  // Both clear countStationsWithin, so this is the signal that ranks the real one first.
  const velib = [
    { lat: 48.8566, lon: 2.3522, capacity: 35, virtual: false },
    { lat: 48.857, lon: 2.353, capacity: 60, virtual: false },
  ];
  const voi = Array.from({ length: 40 }, () => ({
    lat: 48.857,
    lon: 2.353,
    capacity: 4,
    virtual: true,
  }));

  assert.equal(countStationsWithin(voi, paris, 15), 40, "virtual bays still count as stations");
  assert.equal(countPhysicalDocksWithin(voi, paris, 15), 0, "but none of them is a physical dock");
  assert.equal(countPhysicalDocksWithin(velib, paris, 15), 2);
  // Ranking, not filtering: an all-virtual hub system (Donkey Republic) must still be reachable.
  assert.ok(countStationsWithin(voi, paris, 15) > 0);
});

test("readStations defaults a missing capacity to 0 rather than NaN", () => {
  // A NaN capacity would make `capacity > 0` false anyway, but only by accident; 0 makes the
  // "not a dock" reading explicit.
  const parsed = readStations({
    data: { stations: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4, capacity: "12" }] },
  });
  assert.deepEqual(parsed, [
    { lat: 1, lon: 2, capacity: 0, virtual: false },
    { lat: 3, lon: 4, capacity: 12, virtual: false },
  ]);
});

test("readStations tolerates a malformed payload", () => {
  assert.deepEqual(readStations(null), []);
  assert.deepEqual(readStations({}), []);
  assert.deepEqual(readStations({ data: { stations: "nope" } }), []);
  // A station missing coordinates is skipped, not NaN-ed into the count.
  assert.deepEqual(readStations({ data: { stations: [{ lat: 1, lon: 2, capacity: 5 }, { lat: null }] } }), [
    { lat: 1, lon: 2, capacity: 5, virtual: false },
  ]);
});

test("hasBicycleForm rejects a car-share", () => {
  // Real: Stadtmobil Karlsruhe. Without this the matcher would call it Karlsruhe's bikeshare.
  const carShare = { data: { vehicle_types: [{ vehicle_type_id: "1", form_factor: "car" }] } };
  assert.equal(hasBicycleForm(carShare), false);
});

test("hasBicycleForm accepts a mixed fleet on its bicycles", () => {
  // Real: Bicing returns bicycle + scooter_standing.
  const mixed = { data: { vehicle_types: [{ form_factor: "bicycle" }, { form_factor: "scooter_standing" }] } };
  assert.equal(hasBicycleForm(mixed), true);
});

test("hasBicycleForm accepts an absent feed", () => {
  // Real: Velo Antwerpen publishes no vehicle_types at all and is a genuine bikeshare. Silence is
  // not a disqualifying claim — only an explicit non-bike fleet is.
  assert.equal(hasBicycleForm(null), true);
  assert.equal(hasBicycleForm({}), true);
  assert.equal(hasBicycleForm({ data: { vehicle_types: [] } }), true);
});

const plans = (list) => ({ data: { plans: list } });

test("readDayPass accepts an unambiguous day pass", () => {
  const found = readDayPass(plans([{ name: "Day Pass", currency: "USD", price: 8 }]));
  assert.deepEqual(found, { amount: 8, currency: "USD" });
});

test("readDayPass coerces a price published as a string", () => {
  // Real: Capital Bike Share publishes price: "1.00".
  const found = readDayPass(plans([{ name: "24-Hour Pass", currency: "usd", price: "1.00" }]));
  assert.deepEqual(found, { amount: 1, currency: "USD" });
});

test("readDayPass treats price 0 as 'not stated', never as free", () => {
  // Real: PubliBike publishes {name: "Bike pricing", price: 0.0}. Reporting that as a free
  // bikeshare would put a confident falsehood into the traveler's budget.
  assert.equal(readDayPass(plans([{ name: "Day Pass", currency: "CHF", price: 0 }])), null);
  assert.equal(readDayPass(plans([{ name: "Bike pricing", currency: "CHF", price: 0 }])), null);
});

test("readDayPass never lifts a number out of the plan name", () => {
  // Real: nextbike Zlín names a plan "CZK 2/min, max. CZK 500/24h" with price 0. It matches "24h"
  // but it is a per-minute tariff, and neither 2 nor 500 is a day pass.
  const zlin = plans([{ name: "CZK 2/min, max. CZK 500/24h", currency: "CZK", price: 0 }]);
  assert.equal(readDayPass(zlin), null);
  // Real: Grad Križevci. Same trap, different shape.
  const krizevci = plans([{ name: "<30min EUR 0, EUR 0.66 (HRK 5) / 30 min", currency: "EUR", price: 0 }]);
  assert.equal(readDayPass(krizevci), null);
});

test("readDayPass rejects a metered or recurring plan even when priced", () => {
  assert.equal(readDayPass(plans([{ name: "Annual membership", currency: "EUR", price: 40 }])), null);
  assert.equal(readDayPass(plans([{ name: "Monthly pass", currency: "EUR", price: 12 }])), null);
  // A day-pass name whose feed also declares per-minute pricing is not a flat fare.
  const metered = plans([
    { name: "Day Pass", currency: "EUR", price: 5, per_min_pricing: [{ start: 30, rate: 1 }] },
  ]);
  assert.equal(readDayPass(metered), null);
});

test("readDayPass requires an explicit currency", () => {
  assert.equal(readDayPass(plans([{ name: "Day Pass", price: 8 }])), null);
  assert.equal(readDayPass(plans([{ name: "Day Pass", currency: "  ", price: 8 }])), null);
});

test("readDayPass reads a GBFS v2 localized name array", () => {
  const v2 = plans([{ name: [{ language: "en", text: "Day Pass" }], currency: "EUR", price: 6 }]);
  assert.deepEqual(readDayPass(v2), { amount: 6, currency: "EUR" });
});

test("readDayPass picks the day pass out of a realistic plan list", () => {
  const found = readDayPass(
    plans([
      { name: "Single ride", currency: "EUR", price: 2 },
      { name: "Annual membership", currency: "EUR", price: 40 },
      { name: "1-Day Pass", currency: "EUR", price: 5 },
    ])
  );
  assert.deepEqual(found, { amount: 5, currency: "EUR" });
});

test("readDayPass tolerates a malformed payload", () => {
  assert.equal(readDayPass(null), null);
  assert.equal(readDayPass({}), null);
  assert.equal(readDayPass({ data: { plans: "nope" } }), null);
  assert.equal(readDayPass(plans([null, 3, "x"])), null);
});

test("readFeedUrls reads both GBFS versions", () => {
  // v3: feeds sit directly under data.
  const v3 = { data: { feeds: [{ name: "station_information", url: "https://s" }] } };
  assert.equal(readFeedUrls(v3).station_information, "https://s");

  // v2: feeds are nested under a language key, and which key varies by operator.
  const v2 = { data: { fr: { feeds: [{ name: "system_pricing_plans", url: "https://p" }] } } };
  assert.equal(readFeedUrls(v2).system_pricing_plans, "https://p");
});

test("readFeedUrls tolerates a malformed payload", () => {
  assert.deepEqual(readFeedUrls(null), {});
  assert.deepEqual(readFeedUrls({ data: { feeds: [{ name: 1, url: 2 }] } }), {});
});
