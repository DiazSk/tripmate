import test from "node:test";
import assert from "node:assert/strict";
import { heroPlaceIn, heroPlaceInRead, heroScene } from "./heroScene.ts";

const none = { destination: null, kind: null, days: null, budget: null, budgetBasis: null, adults: null, children: null, pace: null, interests: [], tags: [], avoidTags: [] };

test("heroPlaceIn: names and aliases", () => {
  assert.equal(heroPlaceIn("5 days in Val d'Orcia"), 2);
  assert.equal(heroPlaceIn("SWITZERLAND in winter"), 1);
  assert.equal(heroPlaceIn("Petra"), 0);
  assert.equal(heroPlaceIn("a week in St. Moritz"), 1);
  assert.equal(heroPlaceIn("somewhere warm"), -1);
});

test("heroPlaceIn: never inside a word", () => {
  for (const t of ["Jordanian food", "Petraeus", "Romanian wine"]) assert.equal(heroPlaceIn(t), -1, t);
});

test("heroScene: a read elsewhere names it and keeps the photo", () => {
  assert.deepEqual(heroScene({ ...none, destination: "Lisbon, Portugal" }, -1, 3), { index: 3, elsewhere: "Lisbon" });
});

test("heroScene: a read hero place wins over typing", () => {
  assert.deepEqual(heroScene({ ...none, destination: "Jaipur, India" }, 0, 3), { index: 3, elsewhere: null });
});

test("heroScene: typing, then rotation", () => {
  assert.deepEqual(heroScene(null, 2, 4), { index: 2, elsewhere: null });
  assert.deepEqual(heroScene({ ...none, kind: "somewhere warm" }, -1, 4), { index: 4, elsewhere: null });
});

test("heroScene: a read matches on its place, not the geocoder's country", () => {
  assert.deepEqual(heroScene({ ...none, destination: "Zurich, Switzerland" }, -1, 3), { index: 3, elsewhere: "Zurich" });
  assert.deepEqual(heroScene({ ...none, destination: "Amman, Jordan" }, -1, 3), { index: 3, elsewhere: "Amman" });
  assert.deepEqual(heroScene({ ...none, destination: "Bucharest, Romania" }, -1, 3), { index: 3, elsewhere: "Bucharest" });
  assert.deepEqual(heroScene({ ...none, destination: "Jaipur, India" }, -1, 0), { index: 3, elsewhere: null });
  assert.equal(heroPlaceInRead("Petra, Jordan"), 0);
  assert.equal(heroPlaceInRead("Amman, Jordan"), -1);
  // Typed text keeps the country: the traveller said it.
  assert.equal(heroPlaceIn("a week in Switzerland"), 1);
});

test("heroScene: a read with no place before its comma names nothing", () => {
  assert.deepEqual(heroScene({ ...none, destination: ",x" }, -1, 2), { index: 2, elsewhere: null });
});
