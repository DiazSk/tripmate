/* Run: node --test src/lib/userAnswers.test.mjs
 *
 * These weights decide how full a day feels, and they are the first thing anyone
 * will adjust after reading a few real itineraries. The asserts pin the two ends
 * of the range and the floor, so a tuning change that accidentally collapses the
 * scale fails here instead of in a generated trip. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveFamilyRules,
  deriveFlags,
  derivePaceSpotsPerDay,
  labelPace,
  PACE_FLOOR,
  PARTY_MAX_PER_BAND,
  sanitizeLogistics,
  sanitizeParty,
  deriveGroupLabel,
} from "./userAnswers.ts";

const answers = (over) => ({
  purpose: "leisure",
  explorerStyle: "mixed",
  group: "solo",
  energy: "moderate",
  crowds: "mixed",
  budget: 1000,
  priorities: [],
  topPriorities: [],
  selectedPois: [],
  customPois: [],
  ...over,
});

test("a packed, high-energy solo traveler gets the top of the range", () => {
  assert.equal(derivePaceSpotsPerDay("packed", "solo", "high"), 5);
  assert.equal(labelPace(5), "fast");
});

test("energy and kids step the pace down, and the floor holds", () => {
  // relaxed ceiling 3, low energy -2, family -1 = 0, floored to PACE_FLOOR.
  assert.equal(derivePaceSpotsPerDay("relaxed", "family_with_kids", "low"), PACE_FLOOR);
  assert.equal(labelPace(PACE_FLOOR), "slow");
});

test("a low-energy traveler gets every mobility constraint set", () => {
  const flags = deriveFlags(answers({ energy: "low" }));
  assert.deepEqual(flags.mobilityProfile, {
    walkLegCap: "tight",
    minimizeStairs: true,
    restBreaks: true,
    preferTransitOverLongWalks: true,
  });
});

test("familyRules is null for anyone not travelling with kids", () => {
  assert.equal(deriveFlags(answers({ group: "solo" })).familyRules, null);
  assert.ok(deriveFlags(answers({ group: "family_with_kids" })).familyRules);
});

test("an unrecognized explorer style falls back instead of producing NaN", () => {
  // @ts-expect-error — deliberately passing a value outside the enum to prove the fallback
  const result = derivePaceSpotsPerDay("bogus", "solo", "high");
  assert.ok(Number.isFinite(result), `expected a finite number, got ${result}`);
});

test("starred priorities become primary, the rest tiebreakers", () => {
  const flags = deriveFlags(
    answers({ priorities: ["Food", "Nightlife", "Shopping"], topPriorities: ["Food"] })
  );
  assert.deepEqual(flags.prioritiesRanked, {
    primary: ["Food"],
    tiebreakers: ["Nightlife", "Shopping"],
  });
});

// --- party composition -------------------------------------------------------------------------

const party = (over) => ({ adults: 2, children: 0, infants: 0, ...over });

test("an infant steps the pace down on top of the family step", () => {
  // packed ceiling 5, high energy 0, family -1, infant -1.
  assert.equal(derivePaceSpotsPerDay("packed", "family_with_kids", "high", party({ infants: 1 })), 3);
  // The same party without the infant keeps the stop.
  assert.equal(derivePaceSpotsPerDay("packed", "family_with_kids", "high", party({ children: 1 })), 4);
});

test("kids make a family whatever pill was picked", () => {
  // The bug the counts expose: "other" with two kids used to plan like a group of adults.
  const rules = deriveFamilyRules("other", party({ children: 2 }));
  assert.ok(rules, "children in the party must fire the family rules");
  assert.equal(rules.kidFriendlyBias, true);
  assert.equal(rules.youngestBand, "child");
  assert.equal(rules.strollerAccess, false, "no infant, no stroller rule");

  // And an adults-only party does not, even though it is more than one person.
  assert.equal(deriveFamilyRules("other", party()), null);
});

test("an infant sets the stroller and nap rules and the youngest band", () => {
  const rules = deriveFamilyRules("couple", party({ children: 1, infants: 1 }));
  assert.equal(rules.strollerAccess, true);
  assert.equal(rules.napWindow, true);
  assert.equal(rules.youngestBand, "infant", "the youngest traveler sets the band, not the eldest");
});

test("the family pill with no counts still works, and claims no band it wasn't told", () => {
  // Every trip stored before the counts existed takes this path.
  const rules = deriveFamilyRules("family_with_kids", null);
  assert.equal(rules.kidFriendlyBias, true);
  assert.equal(rules.youngestBand, null);
  assert.equal(rules.strollerAccess, false);
  assert.equal(derivePaceSpotsPerDay("mixed", "family_with_kids", "high"), 3);
});

test("absent party answers leave the flags exactly as they were", () => {
  const flags = deriveFlags(answers());
  assert.equal(flags.partySize, null);
  assert.equal(flags.familyRules, null);
});

test("party size counts every head", () => {
  const flags = deriveFlags(answers({ party: party({ children: 2, infants: 1 }) }));
  assert.equal(flags.partySize, 5);
});

// --- the trust boundary ------------------------------------------------------------------------
// `POST /api/itinerary` takes userAnswers as `unknown` with no parser, so a raw request reaches
// deriveFlags unchecked. Garbage must clamp, not arrive in the prompt as NaN.

test("garbage party counts clamp instead of reaching the prompt", () => {
  assert.deepEqual(sanitizeParty({ adults: "x", children: -5, infants: 999 }), {
    adults: 1,
    children: 0,
    infants: PARTY_MAX_PER_BAND,
  });
  assert.deepEqual(sanitizeParty({ adults: 2.7, children: 1.2, infants: 0 }), {
    adults: 2,
    children: 1,
    infants: 0,
  });
  assert.equal(sanitizeParty(null), null, "absent stays absent — it is not a party of one");
  assert.equal(sanitizeParty("nope"), null);
});

test("a malformed party still produces usable flags rather than NaN", () => {
  const flags = deriveFlags(answers({ party: { adults: "x", children: null, infants: undefined } }));
  assert.equal(Number.isFinite(flags.paceSpotsPerDay), true);
  assert.equal(flags.partySize, 1);
});

// --- logistics ---------------------------------------------------------------------------------

test("only a real HH:MM survives sanitizing", () => {
  const clean = sanitizeLogistics({
    arrivalTime: "20:15",
    arrivalPoint: "  Kansai Intl (KIX)  ",
    departureTime: "25:99",
    departurePoint: "",
    stayBooked: null,
  });
  assert.equal(clean.arrivalTime, "20:15");
  assert.equal(clean.arrivalPoint, "Kansai Intl (KIX)", "trimmed");
  assert.equal(clean.departureTime, null, "an impossible clock time is dropped, not passed on");
  assert.equal(clean.departurePoint, null, "an empty string collapses to null");
});

test("an all-empty logistics object collapses to null", () => {
  // The form always sends the object, so this is what keeps a skipped row out of the prompt.
  assert.equal(
    sanitizeLogistics({
      arrivalTime: "",
      arrivalPoint: "",
      departureTime: "",
      departurePoint: "",
      stayBooked: null,
    }),
    null
  );
  assert.equal(sanitizeLogistics(null), null);
});

test("free text reaching the prompt is length-capped", () => {
  const clean = sanitizeLogistics({ arrivalPoint: "x".repeat(500) });
  assert.equal(clean.arrivalPoint.length, 120);
});

test("the traveler's own words describe the group when they gave any", () => {
  assert.equal(deriveGroupLabel("other", "five college friends"), "five college friends");
  assert.equal(deriveGroupLabel("solo", undefined), "solo traveler");
  assert.equal(deriveGroupLabel("couple", ""), "couple");
  // "Other" with nothing typed still says something rather than the raw enum.
  assert.equal(deriveGroupLabel("other", "   "), "group");
  // A stray enum from a raw POST must not produce "undefined".
  assert.equal(deriveGroupLabel("nonsense", undefined), "group");
});
