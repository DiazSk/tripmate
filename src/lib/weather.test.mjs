import test from "node:test";
import assert from "node:assert/strict";

import { getWeatherForDates, getWeatherWithMeta, suggestDestinations } from "./weather.ts";

/**
 * The five rows Open-Meteo really answers `?name=Kyoto&count=12` with, feature codes included.
 * `PRK` is Kyoto Imperial Palace and `AIRH` is Kyoto Heliport — both would anchor a week in
 * Kyoto to the wrong coordinate.
 */
const KYOTO = [
  { latitude: 35.0, longitude: 135.7, name: "Kyoto", country: "Japan", country_code: "JP", feature_code: "PPLA" },
  { latitude: -6.1, longitude: 34.8, name: "Kyoto", country: "Tanzania", country_code: "TZ", feature_code: "PPL" },
  { latitude: 1.2, longitude: 31.4, name: "Kyojomanyi", country: "Uganda", country_code: "UG", feature_code: "PPL" },
  { latitude: 34.9, longitude: 135.8, name: "Kyoto Heliport", country: "Japan", country_code: "JP", feature_code: "AIRH" },
  { latitude: 35.0, longitude: 135.8, name: "Kyoto Imperial Palace", country: "Japan", country_code: "JP", feature_code: "PRK" },
];

function serve(results) {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ results }) });
}

test("a heliport and a palace are not destinations", async () => {
  serve(KYOTO);
  const names = (await suggestDestinations("Kyoto")).map((s) => s.name);
  assert.deepEqual(names, ["Kyoto", "Kyoto", "Kyojomanyi"]);
});

test("a search that is only landmarks answers with them rather than with nothing", async () => {
  serve(KYOTO.filter((r) => r.feature_code === "AIRH" || r.feature_code === "PRK"));
  const names = (await suggestDestinations("Kyoto Imperial Palace")).map((s) => s.name);
  assert.deepEqual(names, ["Kyoto Heliport", "Kyoto Imperial Palace"]);
});

test("a row with no feature code is dropped when better ones exist", async () => {
  serve([{ latitude: 1, longitude: 1, name: "Untagged" }, ...KYOTO.slice(0, 1)]);
  const names = (await suggestDestinations("Kyoto")).map((s) => s.name);
  assert.deepEqual(names, ["Kyoto"]);
});

test("the caller's count is honoured after filtering, not before", async () => {
  serve([...KYOTO, ...KYOTO]);
  assert.equal((await suggestDestinations("Kyoto", 4)).length, 4);
});

/**
 * A trip too far out to forecast reads the same calendar dates one year back. That shift ran on
 * local accessors, so wherever last year's date sat on the other side of a daylight-saving change
 * the hour moved and `toISOString()` rolled back a day — in New York, 2 November read 1 November.
 */
test("a trip beyond the forecast reads the same calendar dates one year back, in any time zone", async () => {
  const realTz = process.env.TZ;
  const realFetch = globalThis.fetch;
  process.env.TZ = "America/New_York";
  let asked;
  globalThis.fetch = async (url) => {
    asked = new URL(url);
    return { ok: true, json: async () => ({ daily: null }) };
  };
  try {
    await getWeatherWithMeta(40.7, -74, "2099-11-02", "2099-11-03");
  } finally {
    globalThis.fetch = realFetch;
    if (realTz === undefined) delete process.env.TZ;
    else process.env.TZ = realTz;
  }
  assert.equal(asked.searchParams.get("start_date"), "2098-11-02");
  assert.equal(asked.searchParams.get("end_date"), "2098-11-03");
});

/**
 * What Open-Meteo really answers (`timezone=auto`, checked against the live API on 2026-10-10)
 * for Lisbon across the night the clocks go back, Sunday 25 October 2026: one `utc_offset_seconds`
 * for the whole range, the summer one, so Sunday's and Monday's sun times arrive an hour late.
 */
const LISBON = {
  timezone: "Europe/Lisbon",
  utc_offset_seconds: 3600,
  daily: {
    time: ["2026-10-24", "2026-10-25", "2026-10-26"],
    temperature_2m_max: [23, 22, 22],
    temperature_2m_min: [16, 17, 15],
    sunrise: ["2026-10-24T07:55", "2026-10-25T07:56", "2026-10-26T07:57"],
    sunset: ["2026-10-24T18:46", "2026-10-25T18:44", "2026-10-26T18:43"],
  },
};

function serveWeather(payload) {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => payload };
  };
  return urls;
}

async function at(now, run) {
  const real = Date.now;
  Date.now = () => Date.parse(now);
  try {
    return await run();
  } finally {
    Date.now = real;
  }
}

test("each day keeps its own offset when the clocks go back mid-trip", async () => {
  serveWeather(LISBON);
  const days = await at("2026-10-10T12:00:00Z", () => getWeatherForDates(38.72, -9.14, "2026-10-24", "2026-10-26"));
  assert.deepEqual(days.map((d) => d.sunrise), ["2026-10-24T07:55", "2026-10-25T06:56", "2026-10-26T06:57"]);
  assert.deepEqual(days.map((d) => d.sunset), ["2026-10-24T18:46", "2026-10-25T17:44", "2026-10-26T17:43"]);
});

test("past the forecast horizon, last year's sun is read on this year's clock", async () => {
  // In 2027 the clocks go back a week later, on 31 October, so the stand-in's Sunday and Monday
  // have to come back on summer time, not the winter time 2026 had already reached by then.
  const urls = serveWeather(LISBON);
  const days = await at("2027-09-01T12:00:00Z", () => getWeatherForDates(38.72, -9.14, "2027-10-24", "2027-10-26"));
  assert.match(urls[0], /archive-api\.open-meteo\.com.*start_date=2026-10-24/);
  assert.deepEqual(days.map((d) => d.sunrise), ["2027-10-24T07:55", "2027-10-25T07:56", "2027-10-26T07:57"]);
  assert.deepEqual(days.map((d) => d.sunset), ["2027-10-24T18:46", "2027-10-25T18:44", "2027-10-26T18:43"]);
});

test("without a zone it can trust, the times are left as Open-Meteo wrote them", async () => {
  for (const payload of [{ ...LISBON, timezone: "Nowhere/Atlantis" }, { ...LISBON, utc_offset_seconds: undefined }]) {
    serveWeather(payload);
    const days = await at("2026-10-10T12:00:00Z", () => getWeatherForDates(38.72, -9.14, "2026-10-24", "2026-10-26"));
    assert.deepEqual(days.map((d) => d.sunrise), LISBON.daily.sunrise);
  }
});

test("the stand-in year keeps the trip's dates wherever the server's own clock is", async () => {
  // A Pacific machine on 2 Nov 2026 is past its clock change and on 1 Nov 2025 is not, so stepping
  // the year back in local time used to land a day early and drop the trip's last day.
  const tz = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const urls = serveWeather(LISBON);
    await at("2026-10-01T12:00:00Z", () => getWeatherForDates(40.71, -74.01, "2026-10-31", "2026-11-02"));
    assert.match(urls[0], /start_date=2025-10-31&end_date=2025-11-02/);
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});
