/* Run: node --test src/lib/destinationFacts.test.mjs
 *
 * These facts are shown to someone waiting on a plan, so the bar is that every one of them is
 * true. The two tests that matter most are the historical/forecast wording split (the app
 * silently falls back to last year's weather beyond ~16 days, and calling that a forecast is
 * a lie the traveler cannot detect) and formatLocalTime (destination-local timestamps with no
 * zone suffix, which `new Date()` would silently reinterpret in the viewer's timezone). */
import assert from "node:assert/strict";
import test from "node:test";
import { buildDestinationFacts, formatLocalTime } from "./destinationFacts.ts";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fixture(overrides = {}) {
  const dates = ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"];
  const rawFetch = {
    dateContext: {
      tripDays: dates.length,
      leadTimeDays: 30,
      season: "fall",
      days: dates.map((date, i) => ({ date, dayOfWeek: DAYS[(6 + i) % 7] })),
    },
    destination: {
      resolved: true,
      lat: 35.01,
      lon: 135.76,
      timezone: "Asia/Tokyo",
      region: "Kyoto Prefecture, Japan",
      countryCode: "JP",
    },
    weather: {
      available: true,
      historical: false,
      days: dates.map((date, i) => ({
        date,
        tempMaxC: 24 + i,
        tempMinC: 12 + i,
        precipitationProbability: i === 2 ? 70 : 15,
        humidity: 60,
        weatherCode: 2,
        sunrise: `${date}T05:48`,
        sunset: `${date}T17:42`,
        historical: false,
      })),
    },
    holidays: {
      available: true,
      events: [{ date: "2026-09-23", name: "Autumnal Equinox Day", localName: "秋分の日" }],
    },
    transportModes: { available: false, modes: [] },
    candidatePois: {
      available: true,
      pois: [
        { name: "Kinkaku-ji", lat: 35.03, lon: 135.72, category: "religion" },
        { name: "Fushimi Inari-taisha", lat: 34.96, lon: 135.77, category: "religion" },
        { name: "Nijō Castle", lat: 35.01, lon: 135.74, category: "historic" },
      ],
    },
    ...(overrides.rawFetch ?? {}),
  };
  return {
    destination: "Kyoto, Japan",
    rawFetch,
    context: null,
    wikiExtract: null,
    viewerUtcOffsetMinutes: -300,
    ...overrides,
    ...(overrides.rawFetch ? { rawFetch } : {}),
  };
}

test("a null bundle with no other source yields no facts at all", () => {
  assert.deepEqual(buildDestinationFacts({ destination: "Kyoto", rawFetch: null }), []);
});

test("an all-empty bundle fabricates nothing", () => {
  const empty = {
    dateContext: { tripDays: 0, leadTimeDays: 0, season: null, days: [] },
    destination: { resolved: false, lat: null, lon: null, timezone: null, region: null, countryCode: null },
    weather: { available: false, historical: false, days: [] },
    holidays: { available: false, events: [] },
    transportModes: { available: false, modes: [] },
    candidatePois: { available: false, pois: [] },
  };
  assert.deepEqual(buildDestinationFacts({ destination: "Nowhere", rawFetch: empty }), []);
});

test("a full bundle produces several facts, all within the length cap", () => {
  const facts = buildDestinationFacts(fixture());
  assert.ok(facts.length >= 5, `expected several facts, got ${facts.length}`);
  for (const f of facts) {
    assert.ok(f.length > 0 && f.length <= 120, `bad length (${f.length}): ${f}`);
  }
});

/* The lie this guards against: past ~16 days the app serves last year's same dates. Nothing
 * in that branch may present itself as a forecast. */
test("historical weather never claims a forecast", () => {
  const base = fixture();
  const days = base.rawFetch.weather.days.map((d) => ({
    ...d,
    precipitationProbability: null,
    humidity: null,
    weatherCode: null,
    historical: true,
  }));
  const input = {
    ...base,
    rawFetch: { ...base.rawFetch, weather: { available: true, historical: true, days } },
  };
  const facts = buildDestinationFacts(input);
  for (const f of facts) {
    assert.doesNotMatch(f, /forecast|expect|will be/i, `historical fact implies a forecast: ${f}`);
  }
  assert.ok(
    facts.some((f) => /last year/i.test(f)),
    "historical mode should say the data is last year's"
  );
});

test("forecast weather never talks about last year", () => {
  for (const f of buildDestinationFacts(fixture())) {
    assert.doesNotMatch(f, /last year/i, `forecast fact referenced last year: ${f}`);
  }
});

test("no duplicates, even when every day's weather is identical", () => {
  const base = fixture();
  const flat = base.rawFetch.weather.days.map((d) => ({
    ...d,
    tempMaxC: 20,
    tempMinC: 14,
    precipitationProbability: 10,
  }));
  const input = { ...base, rawFetch: { ...base.rawFetch, weather: { ...base.rawFetch.weather, days: flat } } };
  const facts = buildDestinationFacts(input);
  assert.equal(new Set(facts).size, facts.length);
});

test("output is deterministic across calls", () => {
  assert.deepEqual(buildDestinationFacts(fixture()), buildDestinationFacts(fixture()));
});

test("weather cannot flood the feed, even with the wider cap", () => {
  // Was "no more than two". PER_FAMILY went 2 -> 5 so the wait can run ~150s without looping, and
  // the guarantee that matters is unchanged: a seven-day forecast must not become the whole feed.
  const facts = buildDestinationFacts(fixture(), 50);
  const weatherish = facts.filter((f) => /°C|chance of rain|Humidity/.test(f));
  assert.ok(weatherish.length <= 5, `weather exceeded its family cap: ${JSON.stringify(weatherish)}`);
  assert.ok(
    weatherish.length < facts.length / 2,
    `weather was more than half the feed: ${weatherish.length} of ${facts.length}`
  );
});

test("the first three facts come from three different families", () => {
  const facts = buildDestinationFacts({
    ...fixture(),
    wikiExtract: "Kyoto is a city on the island of Honshu that served as the capital of Japan.",
  });
  const familyOf = (f) => {
    if (/public holiday|holidays land/.test(f)) return "holiday";
    if (/Wikipedia$/.test(f)) return "wiki";
    if (/in range|rated sight/.test(f)) return "poi";
    if (/°C|chance of rain|Humidity/.test(f)) return "weather";
    if (/sun sets|daylight/.test(f)) return "sun";
    return "other";
  };
  const first3 = facts.slice(0, 3).map(familyOf);
  assert.equal(new Set(first3).size, 3, `families repeated early: ${JSON.stringify(first3)}`);
});

test("limit is respected and over-asking is a no-op", () => {
  assert.equal(buildDestinationFacts(fixture(), 3).length, 3);
  const all = buildDestinationFacts(fixture(), 999);
  assert.ok(all.length > 3 && all.length < 999);
});

test("each source going unavailable drops only its own family", () => {
  const base = fixture();
  const withHoliday = buildDestinationFacts(base).some((f) => /public holiday/.test(f));
  assert.ok(withHoliday, "fixture should produce a holiday fact");

  const noHolidays = buildDestinationFacts({
    ...base,
    rawFetch: { ...base.rawFetch, holidays: { available: false, events: [] } },
  });
  assert.ok(!noHolidays.some((f) => /public holiday/.test(f)));
  assert.ok(noHolidays.length > 0, "other families should survive");

  const noPois = buildDestinationFacts({
    ...base,
    rawFetch: { ...base.rawFetch, candidatePois: { available: false, pois: [] } },
  });
  assert.ok(!noPois.some((f) => /in range/.test(f)));
  assert.ok(noPois.length > 0);
});

test("a weather date missing from the trip window is dropped, not mislabelled", () => {
  const base = fixture();
  const stray = base.rawFetch.weather.days.map((d, i) =>
    i === 2 ? { ...d, date: "2099-01-01" } : d
  );
  const facts = buildDestinationFacts({
    ...base,
    rawFetch: { ...base.rawFetch, weather: { ...base.rawFetch.weather, days: stray } },
  });
  // The 70%-rain day is the stray one; it must not surface with an invented day number.
  assert.ok(!facts.some((f) => /chance of rain/.test(f)));
});

test("a holiday whose local name matches renders without empty parentheses", () => {
  const base = fixture();
  const facts = buildDestinationFacts({
    ...base,
    rawFetch: {
      ...base.rawFetch,
      holidays: {
        available: true,
        events: [{ date: "2026-09-23", name: "Equinox Day", localName: "Equinox Day" }],
      },
    },
  });
  const holiday = facts.find((f) => /public holiday/.test(f));
  assert.ok(holiday);
  assert.doesNotMatch(holiday, /\(\s*\)/);
});

test("every wikipedia sentence carries its own attribution, one sentence each", () => {
  const facts = buildDestinationFacts({
    ...fixture(),
    wikiExtract:
      "Kyoto is a city in Japan. It was the capital for over a thousand years. Many temples remain.",
  });
  const wiki = facts.filter((f) => /Wikipedia$/.test(f));
  assert.equal(wiki.length, 3, "all three sentences should surface, not just the first");
  // CC BY-SA: every quoted line carries the credit, not just the first of a run.
  for (const f of wiki) assert.match(f, / — Wikipedia$/);
  // One sentence per fact — the split is what keeps them glanceable.
  for (const f of wiki) {
    const body = f.replace(/ — Wikipedia$/, "");
    assert.equal(body.split(". ").length, 1, `expected one sentence, got: ${body}`);
  }
  assert.ok(
    facts.indexOf(wiki[0]) < facts.indexOf(wiki[1]),
    "document order should survive ranking"
  );
});

test("a long opening sentence no longer suppresses the rest of the extract", () => {
  // The real failure this fixes: Kyoto's live opening sentence is 146 characters, so with
  // attribution it clears MAX_LEN and the old first-sentence-only reader returned nothing at
  // all — the richest extracts produced zero facts while thin ones produced theirs.
  const long = `Kyoto, officially Kyoto City, is the capital city of Kyoto Prefecture in the Kansai region of Japan's largest and most populous island of Honshu.`;
  assert.ok(long.length > 120, "fixture must actually exceed MAX_LEN");
  const facts = buildDestinationFacts({
    ...fixture(),
    wikiExtract: `${long} More than half of the prefecture's population resides in the city.`,
  });
  const wiki = facts.filter((f) => /Wikipedia$/.test(f));
  assert.equal(wiki.length, 1, "the short second sentence should still surface");
  assert.match(wiki[0], /^More than half/);
});

test("an over-long wikipedia sentence is dropped rather than truncated", () => {
  const facts = buildDestinationFacts({
    ...fixture(),
    wikiExtract: `${"Kyoto is a remarkably historic city ".repeat(8)}and more.`,
  });
  assert.ok(!facts.some((f) => /Wikipedia$/.test(f)));
});

test("formatLocalTime handles midnight, noon and malformed input", () => {
  assert.equal(formatLocalTime("2026-08-14T18:42"), "6:42pm");
  assert.equal(formatLocalTime("2026-08-14T00:15"), "12:15am");
  assert.equal(formatLocalTime("2026-08-14T12:00"), "12:00pm");
  assert.equal(formatLocalTime("2026-08-14T09:05"), "9:05am");
  assert.equal(formatLocalTime(null), null);
  assert.equal(formatLocalTime("nonsense"), null);
  assert.equal(formatLocalTime("2026-08-14T99:00"), null);
});

test("every festival and shopping area surfaces, not just the first", () => {
  const facts = buildDestinationFacts({
    ...fixture(),
    context: {
      festivals: [
        { name: "Jidai Matsuri", dates: "October 22", note: "" },
        { name: "Kurama Fire Festival", dates: "October 22", note: "" },
      ],
      safety: [{ note: "Pickpockets in crowds", severity: "medium" }],
      shopping: [
        { name: "Nishiki Market", area: "central Kyoto", note: "" },
        { name: "Teramachi", area: "Nakagyo", note: "" },
      ],
      trends: [],
    },
  }, 50);
  assert.ok(facts.some((f) => /Jidai Matsuri/.test(f)));
  assert.ok(facts.some((f) => /Kurama Fire Festival/.test(f)), "only festivals[0] surfaced");
  assert.ok(facts.some((f) => /Nishiki Market/.test(f)));
  assert.ok(facts.some((f) => /Teramachi/.test(f)), "only shopping[0] surfaced");
});

test("trends surface; safety notes still do not", () => {
  // Trends are "popular new spots, seasonal crowds" — the right register for a waiting screen.
  // Safety stays out by decision, not omission: "pickpockets in crowds" is useful inside a plan
  // and a sour thing to read while waiting for a holiday to be written. The model still gets it.
  const facts = buildDestinationFacts({
    ...fixture(),
    context: {
      festivals: [],
      safety: [{ note: "Pickpockets in crowds", severity: "medium" }],
      shopping: [],
      trends: [{ note: "Higashiyama gets very busy at sunset" }],
    },
  }, 50);
  assert.ok(facts.some((f) => /Higashiyama gets very busy at sunset/.test(f)));
  assert.ok(!facts.some((f) => /Pickpockets/.test(f)), "a safety note reached the feed");
});

test("candidate places past the first three are named too", () => {
  const base = fixture();
  const pois = Array.from({ length: 9 }, (_, i) => ({
    name: `Place ${i + 1}`, lat: 35 + i / 100, lon: 135, category: "sight",
  }));
  const facts = buildDestinationFacts(
    { ...base, rawFetch: { ...base.rawFetch, candidatePois: { available: true, pois } } },
    50
  );
  // Twelve fetched places used to produce exactly one line naming three of them.
  assert.ok(facts.some((f) => /Place 1, Place 2 and Place 3/.test(f)));
  assert.ok(facts.some((f) => /Place 4, Place 5 and Place 6/.test(f)), "only the first trio surfaced");
});
