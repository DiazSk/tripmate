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

test("no more than two facts come from the weather family", () => {
  const facts = buildDestinationFacts(fixture(), 50);
  const weatherish = facts.filter((f) => /°C|chance of rain|Humidity/.test(f));
  assert.ok(weatherish.length <= 2, `weather flooded the feed: ${JSON.stringify(weatherish)}`);
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

test("wikipedia facts are one sentence and carry attribution", () => {
  const facts = buildDestinationFacts({
    ...fixture(),
    wikiExtract:
      "Kyoto is a city in Japan. It was the capital for over a thousand years. Many temples remain.",
  });
  const wiki = facts.find((f) => /Wikipedia$/.test(f));
  assert.ok(wiki, "expected a wikipedia fact");
  assert.ok(!/thousand years/.test(wiki), "should stop at the first sentence");
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

test("destination context supplies festival and shopping facts", () => {
  const facts = buildDestinationFacts({
    ...fixture(),
    context: {
      festivals: [{ name: "Jidai Matsuri", dates: "October 22", note: "" }],
      safety: [{ note: "Pickpockets in crowds", severity: "medium" }],
      shopping: [{ name: "Nishiki Market", area: "central Kyoto", note: "" }],
      trends: [{ note: "ignored" }],
    },
  }, 50);
  assert.ok(facts.some((f) => /Jidai Matsuri/.test(f)));
  // Safety and trends are deliberately never surfaced.
  assert.ok(!facts.some((f) => /Pickpockets|ignored/.test(f)));
});
