import { test } from "node:test";
import assert from "node:assert/strict";

import { profileSentence } from "./profileSentence.ts";

const base = {
  group: "couple",
  explorerStyle: "mixed",
  energy: "moderate",
  crowds: "avoid",
  priorities: [],
  topPriorities: [],
  dietary: { tags: [], note: "" },
  accessibility: { stepFree: false, note: "" },
};

test("the bare profile is one sentence, reading the legacy style when the pair is absent", () => {
  assert.equal(
    profileSentence(base),
    "You travel as a couple, at a balanced pace, for a mix of the iconic and the local, walking a moderate amount, away from the crowds."
  );
});

test("stars, dietary tags and home are said only when answered", () => {
  const s = profileSentence({
    ...base,
    pace: "packed",
    discovery: "local",
    topPriorities: ["Food", "Photography"],
    dietary: { tags: ["Vegetarian", "Nut allergy"], note: "" },
    homeCity: { name: "Boston", latitude: 42.36, longitude: -71.06 },
  });
  assert.match(s, /^You travel as a couple, at a packed pace, for local spots over the headline ones,/);
  assert.match(s, / What matters most: Food, Photography\. Every food stop is vegetarian, nut allergy\. You set off from Boston\.$/);
});
