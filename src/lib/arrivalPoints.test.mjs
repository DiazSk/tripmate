/* Run: node --test src/lib/arrivalPoints.test.mjs
 *
 * The parser is the whole risk in this feature. Overpass hands back three element kinds in one
 * response, in two coordinate shapes, with names in the local language and the same airport listed
 * several times — and every one of those is silent when it goes wrong: the dropdown just shows
 * something slightly useless. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AIRPORT_RANGE_KM,
  MAX_POINTS,
  STATION_RANGE_KM,
  buildArrivalPointsQuery,
  parseArrivalPoints,
} from "./arrivalPoints.ts";

/** Kyoto. */
const ORIGIN = { lat: 35.0116, lon: 135.7681 };

const KANSAI = {
  center: { lat: 34.4342, lon: 135.2325 },
  tags: { aeroway: "aerodrome", name: "関西国際空港", "name:en": "Kansai International Airport", iata: "KIX" },
};
const KYOTO_STATION = {
  lat: 34.9858,
  lon: 135.7588,
  tags: { railway: "station", name: "京都駅", "name:en": "Kyoto Station" },
};

test("builds one union query, not one request per kind", () => {
  const q = buildArrivalPointsQuery(35.0116, 135.7681);
  assert.match(q, /aeroway.+railway/s, "both clauses in a single query");
  assert.equal(q.match(/nwr\[/g).length, 2, "two clauses, one query overall");
  assert.doesNotMatch(q, /bus_station/, "dropped: a third of the query for a case nobody has");
  assert.match(q, /\["train"="yes"\]/, "mainline only — unfiltered, Tokyo 504'd");
  assert.match(q, /\["military"!~"\."\]/, "an IATA code does not mean passenger service");
  assert.match(q, /\["iata"\]/, "airports without an IATA code are airstrips and flying clubs");
  assert.match(q, /out center tags;/, "center is what makes ways and relations usable");
});

test("the airport range reaches the airport the city is actually served by", () => {
  // Kansai is 81km from Kyoto. Any range that feels generous but isn't drops it silently — the
  // dropdown simply omits the airport the traveler flew into, with nothing to say it did.
  assert.ok(AIRPORT_RANGE_KM > 81, "must clear Kyoto -> Kansai");
  assert.ok(STATION_RANGE_KM < AIRPORT_RANGE_KM, "or the response is mostly discarded stations");
});

test("queries a bounding box, not a radius", () => {
  // `around:` timed out server-side at 32s against the public instance and returned it as a 200
  // carrying a remark. The box form of the same query answered in 18s.
  const q = buildArrivalPointsQuery(35.0116, 135.7681);
  assert.doesNotMatch(q, /around:/, "around: is what timed out");
  const boxes = [...q.matchAll(/\(([-\d.]+,[-\d.]+,[-\d.]+,[-\d.]+)\)/g)].map((m) =>
    m[1].split(",").map(Number)
  );
  assert.equal(boxes.length, 2);
  for (const [s_, w, n, e] of boxes) {
    assert.ok(s_ < 35.0116 && n > 35.0116, "latitude brackets the origin");
    assert.ok(w < 135.7681 && e > 135.7681, "longitude brackets the origin");
  }
  const widthOf = ([, w, , e]) => e - w;
  assert.ok(widthOf(boxes[0]) > widthOf(boxes[1]), "airports get the wide box");
});

test("longitude widens toward the poles", () => {
  // A degree of longitude is ~111km at the equator and ~55km at 60N. Using a fixed degree offset
  // would make the box half as wide as intended in Oslo.
  const spanAt = (lat) => {
    const [, w, , e] = buildArrivalPointsQuery(lat, 10)
      .match(/\(([-\d.]+,[-\d.]+,[-\d.]+,[-\d.]+)\)/)[1]
      .split(",")
      .map(Number);
    return e - w;
  };
  assert.ok(spanAt(60) > spanAt(0) * 1.9, "Oslo's box spans about twice the degrees Nairobi's does");
});

test("reads both coordinate shapes Overpass returns", () => {
  // Nodes carry lat/lon; ways and relations carry center. One response mixes them.
  const out = parseArrivalPoints([KANSAI, KYOTO_STATION], ORIGIN);
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => Number.isFinite(p.distanceKm)));
});

test("prefers the English name and appends the IATA code", () => {
  const [airport] = parseArrivalPoints([KANSAI], ORIGIN);
  assert.equal(airport.name, "Kansai International Airport (KIX)");
  assert.equal(airport.kind, "airport");
  assert.equal(airport.distanceKm, 81, "Kyoto to Kansai");
});

test("does not repeat a code the name already carries", () => {
  const [p] = parseArrivalPoints(
    [{ ...KANSAI, tags: { ...KANSAI.tags, "name:en": "Kansai (KIX)" } }],
    ORIGIN
  );
  assert.equal(p.name, "Kansai (KIX)");
});

test("collapses the duplicate elements one airport is modelled as", () => {
  // OSM has a node for the point and a way for the grounds. Both come back.
  const out = parseArrivalPoints(
    [KANSAI, { lat: 34.4353, lon: 135.2441, tags: { ...KANSAI.tags } }],
    ORIGIN
  );
  assert.equal(out.length, 1, "same name, one entry");
});

test("airports rank above stations even when the station is closer", () => {
  const out = parseArrivalPoints([KYOTO_STATION, KANSAI], ORIGIN);
  assert.deepEqual(
    out.map((p) => p.kind),
    ["airport", "rail"],
    "Kyoto Station is 3km away and Kansai is 73km — the airport still comes first"
  );
});

test("within a kind, nearest wins", () => {
  // Both inside the station range — the point here is the ordering, not the cut-off.
  const further = { lat: 34.94, lon: 135.76, tags: { railway: "station", name: "Yamashina" } };
  const out = parseArrivalPoints([further, KYOTO_STATION], ORIGIN);
  assert.deepEqual(out.map((p) => p.name), ["Kyoto Station", "Yamashina"]);
});

test("caps the list", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    lat: 35 + i / 100,
    lon: 135.7,
    tags: { railway: "station", name: `Station ${i}` },
  }));
  assert.equal(parseArrivalPoints(many, ORIGIN).length, MAX_POINTS);
});

test("skips anything unusable rather than emitting a broken row", () => {
  const junk = [
    { tags: { railway: "station", name: "No coordinates" } },
    { lat: 35, lon: 135.7, tags: { railway: "station" } }, // nameless
    { lat: 35, lon: 135.7, tags: { name: "Untyped place" } }, // not a transport tag
    { lat: 35, lon: 135.7, tags: { railway: "station", name: "   " } }, // blank after trim
    { lat: NaN, lon: 135.7, tags: { railway: "station", name: "Bad coords" } },
    {}, // no tags at all
  ];
  assert.deepEqual(parseArrivalPoints(junk, ORIGIN), []);
});

test("an empty response is a real answer, not a failure", () => {
  // Distinct from the null the route returns when Overpass itself didn't answer.
  assert.deepEqual(parseArrivalPoints([], ORIGIN), []);
  assert.deepEqual(parseArrivalPoints(null, ORIGIN), []);
});

// --- what the first live run got wrong ------------------------------------------------------

test("trims the bbox corners that are out of real range", () => {
  // The box circumscribes the circle, so its corners reach ~1.4x the range. Gifu Airbase, 109km
  // from Kyoto, came back through one on the first live run and was offered as an arrival point.
  const tooFar = {
    lat: 35.394,
    lon: 136.87,
    tags: { aeroway: "aerodrome", name: "Gifu Airbase", iata: "QGU" },
  };
  assert.deepEqual(parseArrivalPoints([tooFar], ORIGIN), []);
  assert.equal(parseArrivalPoints([tooFar, KANSAI], ORIGIN).length, 1, "Kansai at 81km stays");
});

test("stations are held to their own tighter range", () => {
  const farStation = { lat: 34.7333, lon: 135.5, tags: { railway: "station", name: "Shin-Osaka" } };
  assert.deepEqual(parseArrivalPoints([farStation], ORIGIN), [], "39km is not this city's station");
});

test("airports cannot crowd the station out of the list", () => {
  // The real Kyoto response returned six airports and no Kyoto Station, because one global cap
  // plus airports-first meant ground transport never reached the list at all.
  const airports = ["ITM", "UKB", "KIX", "NGO"].map((iata, i) => ({
    lat: 34.6 - i / 50,
    lon: 135.5,
    tags: { aeroway: "aerodrome", name: `Airport ${iata}`, iata },
  }));
  const out = parseArrivalPoints([...airports, KYOTO_STATION], ORIGIN);
  assert.ok(
    out.some((p) => p.name === "Kyoto Station"),
    "the place most travelers actually arrive at has to be reachable"
  );
});

test("when both kinds compete for the room, each is held to its quota", () => {
  const airports = ["ITM", "UKB", "KIX", "NGO"].map((iata, i) => ({
    lat: 34.6 - i / 50,
    lon: 135.5,
    tags: { aeroway: "aerodrome", name: `Airport ${iata}`, iata },
  }));
  const stations = Array.from({ length: 4 }, (_, i) => ({
    lat: 35.0116 + i / 500,
    lon: 135.7681,
    tags: { railway: "station", name: `Station ${i}` },
  }));
  const out = parseArrivalPoints([...airports, ...stations], ORIGIN);
  assert.equal(out.filter((p) => p.kind === "airport").length, 3);
  assert.equal(out.filter((p) => p.kind !== "airport").length, 3);
});

test("a kind that is short lets the other take the room", () => {
  // No airports nearby should mean six stations, not three and four empty rows.
  const stations = Array.from({ length: 8 }, (_, i) => ({
    lat: 35.0116 + i / 500,
    lon: 135.7681,
    tags: { railway: "station", name: `Station ${i}` },
  }));
  assert.equal(parseArrivalPoints(stations, ORIGIN).length, MAX_POINTS);
});

// --- ranking, as the live runs corrected it ---------------------------------------------------

test("an international airport outranks a nearer domestic one", () => {
  // Measured against Paris: Le Bourget is 13km and Charles de Gaulle 23km, so sorting airports on
  // distance alone pushed CDG off a three-slot list. Same shape in Tokyo, where Narita lost to two
  // military airfields before those were excluded at the query.
  const intl = {
    lat: 49.0097,
    lon: 2.5479,
    tags: { aeroway: "aerodrome", name: "Charles de Gaulle", iata: "CDG", aerodrome: "international" },
  };
  const nearer = {
    lat: 48.9694,
    lon: 2.4414,
    tags: { aeroway: "aerodrome", name: "Le Bourget", iata: "LBG" },
  };
  const out = parseArrivalPoints([nearer, intl], { lat: 48.8566, lon: 2.3522 });
  assert.deepEqual(out.map((p) => p.name), ["Charles de Gaulle (CDG)", "Le Bourget (LBG)"]);
  assert.ok(out[0].distanceKm > out[1].distanceKm, "and it won despite being further out");
});

test("aerodrome:type carries the same signal as aerodrome", () => {
  const [p] = parseArrivalPoints(
    [{ lat: 35.7647, lon: 140.386, tags: { aeroway: "aerodrome", name: "Narita", iata: "NRT", "aerodrome:type": "international" } }],
    { lat: 35.6895, lon: 139.6917 } // Tokyo — Narita is 370km from Kyoto and out of range there.
  );
  assert.equal(p.tier, 1); // tagged international, but no rank_aci corroborating it — see below
});

test("a real passenger hub outranks a general-aviation field that merely has 'international' in its paperwork", () => {
  // The failure this guards: Seattle's Boeing Field is 9km out and Sea-Tac 18km, so distance
  // alone puts Boeing Field first. Its `aerodrome:type` tag genuinely says "international" —
  // verified live against OSM — because its OFFICIAL name is "King County International
  // Airport", despite it being a general-aviation field with almost no scheduled passenger
  // service. Tags below are the real ones fetched live for both.
  const boeingField = {
    lat: 47.53,
    lon: -122.302,
    tags: {
      aeroway: "aerodrome",
      name: "Boeing Field",
      official_name: "King County International Airport",
      iata: "BFI",
      "aerodrome:type": "international",
    },
  };
  const seaTac = {
    lat: 47.4502,
    lon: -122.3088,
    tags: {
      aeroway: "aerodrome",
      name: "Seattle-Tacoma International Airport",
      iata: "SEA",
      aerodrome: "international",
      "aerodrome:type": "international",
      "rank_aci:2016": "28",
    },
  };
  const out = parseArrivalPoints([boeingField, seaTac], { lat: 47.60621, lon: -122.33207 }); // Seattle
  assert.deepEqual(out.map((p) => p.name), [
    "Seattle-Tacoma International Airport (SEA)",
    "Boeing Field (BFI)",
  ]);
  assert.ok(out[0].distanceKm > out[1].distanceKm, "and it won despite being further out");
});

test("rank_aci is checked by key prefix, not an exact tag name", () => {
  // Real-world tags are year-suffixed (`rank_aci:2016`), so the check can't be an exact match.
  const [p] = parseArrivalPoints(
    [{ lat: 40.6413, lon: -73.7781, tags: { aeroway: "aerodrome", name: "JFK", iata: "JFK", "rank_aci:2019": "5" } }],
    { lat: 40.7128, lon: -74.006 }
  );
  assert.equal(p.tier, 0);
});

test("the tier only sorts airports — a station is never demoted by it", () => {
  const out = parseArrivalPoints([KYOTO_STATION], ORIGIN);
  assert.equal(out[0].tier, 0);
});

test("exposes the bare IATA code separately from the display name", () => {
  // A flight search needs "KIX", not "Kansai (KIX)" — the string it's embedded in for display.
  const [airport] = parseArrivalPoints([KANSAI], ORIGIN);
  assert.equal(airport.iata, "KIX");
});

test("a rail point has no IATA code", () => {
  const [station] = parseArrivalPoints([KYOTO_STATION], ORIGIN);
  assert.equal(station.iata, null);
});

test("a legitimate local regional airport is not overridden by a far-off bigger one", () => {
  // Measured live: with no cap, tier alone picked Boston Logan (79km, tagged international)
  // over Manchester-Boston Regional (7km, no tag) for a traveler in Manchester, NH — and
  // Detroit Metro (62km) over Toledo Express (23km) for a traveler in Toledo, OH. Neither
  // MHT nor TOL is a data-quality trap like Boeing Field; they are real, locally-served
  // airports that simply carry no "international"/rank_aci tag. Past MAX_TIER_OVERRIDE_KM the
  // "better tier" airport is plausibly a different city's own airport, not a lesser
  // alternative to the real local one.
  const manchesterRegional = {
    lat: 42.9326,
    lon: -71.4357,
    tags: { aeroway: "aerodrome", name: "Manchester-Boston Regional Airport", iata: "MHT" },
  };
  const bostonLogan = {
    lat: 42.3656,
    lon: -71.0096,
    tags: { aeroway: "aerodrome", name: "Boston Logan International Airport", iata: "BOS", aerodrome: "international" },
  };
  const out = parseArrivalPoints([manchesterRegional, bostonLogan], { lat: 42.9956, lon: -71.4548 }); // Manchester, NH
  assert.deepEqual(out.map((p) => p.iata), ["MHT", "BOS"]);
});

test("the override cap does not disturb a genuinely close pair like CDG/Le Bourget", () => {
  // Sanity check on the boundary itself: the two real cases the tier system exists for (10km
  // and 9km deltas) must still resolve in favor of the better tier, not distance.
  const nearby = { lat: 0, lon: 0, tags: { aeroway: "aerodrome", name: "Regional Field", iata: "RGF" } };
  const fartherButBetter = {
    lat: 0.15, // ~16.7km at the equator — inside the 25km cap
    lon: 0,
    tags: { aeroway: "aerodrome", name: "Big Intl", iata: "BIG", aerodrome: "international" },
  };
  const out = parseArrivalPoints([nearby, fartherButBetter], { lat: 0, lon: 0 });
  assert.deepEqual(out.map((p) => p.iata), ["BIG", "RGF"]);
});
