import test from "node:test";
import assert from "node:assert/strict";

import { suggestDestinations } from "./weather.ts";

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
