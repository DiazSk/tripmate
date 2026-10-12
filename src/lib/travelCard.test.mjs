/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/travelCard.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import {
  answersFromProfile, firstName, loveLine, readyLine, stampDate, stampsFor, welcomeSummary, welcomeToProfile,
} from "./travelCard.ts";

const ISSUED = new Date("2026-10-11T12:00:00Z");
const blank = (o = {}) => ({ name: "Zaid", group: null, pace: null, crowds: null, loves: [], diet: [], home: null, ...o });
const existing = {
  group: "solo", explorerStyle: "offbeat", pace: "packed", discovery: "local", energy: "high", crowds: "love",
  priorities: ["Nightlife"], topPriorities: ["Nightlife"], dietary: { tags: ["Vegan"], note: "no mushrooms" },
  accessibility: { stepFreeRequired: true, limitStairs: true, note: "wheelchair" },
};

test("no answers, no stamps", () => {
  assert.deepEqual(stampsFor(blank(), ISSUED), []);
});

test("each answered step lands its own shape and ink, dated", () => {
  const stamps = stampsFor(blank({ group: "couple", pace: "relaxed", loves: ["Food", "Culture & History"], home: { name: "Boston", latitude: 42.36, longitude: -71.06 } }), ISSUED);
  assert.deepEqual(stamps.map((s) => [s.key, s.shape, s.ink, s.label]), [
    ["group", "circle", "#26407e", "FOR TWO"],
    ["pace", "rect", "#7a2236", "SLOW MORNINGS"],
    ["loves", "oval", "#21583f", "FOOD FIRST"],
    ["home", "hex", "#4a367a", "BOSTON"],
  ]);
  assert.ok(stamps.every((s) => s.date === "11 OCT 26"));
});

test("a long interest is shortened to its first word on the stamp", () => {
  const [loves] = stampsFor(blank({ loves: ["Culture & History"] }), ISSUED);
  assert.equal(loves.label, "CULTURE FIRST");
  assert.equal(stampsFor(blank({ loves: ["Family-Friendly"] }), ISSUED)[0].label, "FAMILY FIRST");
});

test("the stamp date is UTC, so it never rolls back a day west of Greenwich", () => {
  assert.equal(stampDate(new Date("2026-10-11T00:30:00Z")), "11 OCT 26");
});

test("welcomeToProfile maps the tiles onto the profile's own values", () => {
  const p = welcomeToProfile(blank({ group: "family_with_kids", pace: "relaxed", crowds: "avoid", loves: ["Food", "Nature & Outdoors"], diet: ["Halal"] }), null);
  assert.equal(p.group, "family_with_kids");
  assert.equal(p.pace, "relaxed");
  assert.equal(p.crowds, "avoid");
  assert.deepEqual(p.topPriorities, ["Food", "Nature & Outdoors"]);
  assert.deepEqual(p.priorities, ["Food", "Nature & Outdoors"]);
  assert.deepEqual(p.dietary.tags, ["Halal"]);
  assert.equal(p.explorerStyle, "relaxed");
});

test("welcomeToProfile keeps what the welcome does not ask about from an existing profile", () => {
  const p = welcomeToProfile(blank({ group: "couple" }), existing);
  assert.equal(p.group, "couple");
  assert.deepEqual(p.accessibility, existing.accessibility);
  assert.equal(p.energy, "high");
  assert.equal(p.discovery, "local");
  assert.equal(p.pace, "packed");
  assert.equal(p.dietary.note, "no mushrooms");
});

test("answersFromProfile pre-selects a claimed profile's answers", () => {
  const a = answersFromProfile({ ...existing, homeCity: { name: "Lisbon", latitude: 38.7, longitude: -9.1 } }, "Zaid");
  assert.equal(a.group, "solo");
  assert.equal(a.pace, "packed");
  assert.deepEqual(a.loves, ["Nightlife"]);
  assert.deepEqual(a.diet, ["Vegan"]);
  assert.equal(a.home.name, "Lisbon");
  assert.deepEqual(answersFromProfile(null, "Zaid"), blank());
});

test("the summary plays the answers back in one sentence", () => {
  assert.equal(
    welcomeSummary(blank({ group: "couple", pace: "relaxed", crowds: "avoid", loves: ["Food"], diet: ["Vegetarian"] })),
    "Slow mornings, quiet corners, food first, vegetarian tables. Every plan I write for the two of you starts there."
  );
  assert.equal(welcomeSummary(blank()), "Every plan I write starts with what you've told me, and you can tell me more any time on your Profile.");
});

test("names and lines", () => {
  assert.equal(firstName("  zaid shaikh "), "zaid");
  assert.equal(firstName(""), "there");
  assert.equal(readyLine("Zaid Shaikh"), "Your card is done, Zaid. I've got you now.");
  assert.equal(loveLine(["Food"], "Food"), "Food first. Good choice.");
  assert.equal(loveLine(["Food", "Nature & Outdoors", "Photography"], "Photography"), "That's your three. I know what to look for.");
});
