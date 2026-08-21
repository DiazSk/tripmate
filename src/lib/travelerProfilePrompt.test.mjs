/* Run: node --test src/lib/travelerProfilePrompt.test.mjs
 *
 * This block is the only path the traveler's answers take into the prompt, so
 * "says nothing when there is nothing to say" matters as much as what it emits:
 * a caller with no answers must leave the prompt byte-identical to before. */
import assert from "node:assert/strict";
import test from "node:test";
import { formatTravelLegs, formatTravelerProfile } from "./travelerProfilePrompt.ts";

const flags = (over) => ({
  paceSpotsPerDay: 4,
  paceResolved: "fast",
  mobilityProfile: {
    walkLegCap: "normal",
    minimizeStairs: false,
    restBreaks: false,
    preferTransitOverLongWalks: false,
  },
  crowdBias: {
    preferOffpeakTiming: false,
    boostOffbeatPois: false,
    scheduleIconsAtOffpeak: false,
    marketsAndLivelyOk: false,
    peakTimingOk: false,
  },
  prioritiesRanked: { primary: [], tiebreakers: [] },
  familyRules: null,
  partySize: null,
  groupLabel: "solo traveler",
  ...over,
});

const family = (over) => ({
  kidFriendlyBias: true,
  noLateNight: true,
  shortTravelLegs: true,
  strollerAccess: false,
  napWindow: false,
  youngestBand: "child",
  ...over,
});

test("returns an empty string when there are no flags", () => {
  assert.equal(formatTravelerProfile(null), "");
});

test("always states the pace target, and what it does not count", () => {
  const out = formatTravelerProfile(flags({ paceSpotsPerDay: 2, paceResolved: "slow" }));
  assert.match(out, /about 2 sightseeing stops per day/);
  assert.match(out, /"slow"/);
  // The count used to be bare "stops per day", and the model counted meals toward it: a target of
  // 3 came back as one sight plus lunch plus dinner, with the day over by 1pm. Both halves of the
  // fix are asserted because either one alone reproduces the bug.
  assert.match(out, /Meals, coffee and rest breaks do NOT count/);
  assert.match(out, /span the whole day/);
  assert.match(out, /dinner around 18:30-20:30/);
});

test("a low-energy family traveler gets mobility and kid lines", () => {
  const out = formatTravelerProfile(
    flags({
      mobilityProfile: {
        walkLegCap: "tight",
        minimizeStairs: true,
        restBreaks: true,
        preferTransitOverLongWalks: true,
      },
      familyRules: { kidFriendlyBias: true, noLateNight: true, shortTravelLegs: true },
    })
  );
  assert.match(out, /walking legs between stops short/);
  assert.match(out, /avoid stairs/);
  assert.match(out, /rest breaks/);
  assert.match(out, /kid-friendly/);
  assert.match(out, /no late-night/);
});

test("an unconstrained traveler gets neither the mobility nor the kid line", () => {
  const out = formatTravelerProfile(flags());
  assert.doesNotMatch(out, /Mobility:/);
  assert.doesNotMatch(out, /kid-friendly/);
});

test("crowd avoidance and crowd enjoyment are different lines", () => {
  const avoids = formatTravelerProfile(
    flags({
      crowdBias: {
        preferOffpeakTiming: true,
        boostOffbeatPois: true,
        scheduleIconsAtOffpeak: true,
        marketsAndLivelyOk: false,
        peakTimingOk: false,
      },
    })
  );
  assert.match(avoids, /off-peak/);
  assert.doesNotMatch(avoids, /lively areas are welcome/);

  const loves = formatTravelerProfile(
    flags({
      crowdBias: {
        preferOffpeakTiming: false,
        boostOffbeatPois: false,
        scheduleIconsAtOffpeak: false,
        marketsAndLivelyOk: true,
        peakTimingOk: true,
      },
    })
  );
  assert.match(loves, /lively areas are welcome/);
});

test("starred priorities are separated from tiebreakers", () => {
  const out = formatTravelerProfile(
    flags({ prioritiesRanked: { primary: ["Food"], tiebreakers: ["Shopping", "Nightlife"] } })
  );
  assert.match(out, /Top priorities[^\n]*Food/);
  assert.match(out, /Shopping, Nightlife/);
});

test("omits the priorities line entirely when nothing is starred", () => {
  const out = formatTravelerProfile(flags({ prioritiesRanked: { primary: [], tiebreakers: [] } }));
  assert.doesNotMatch(out, /Top priorities/);
});

// --- party -------------------------------------------------------------------------------------

test("party size reaches the prompt as a sizing instruction", () => {
  const out = formatTravelerProfile(flags({ partySize: 6 }));
  assert.match(out, /Party of 6/);
  assert.doesNotMatch(
    formatTravelerProfile(flags()),
    /Party of/,
    "an unanswered party says nothing at all"
  );
});

test("an infant names its own band and adds its own rules", () => {
  const out = formatTravelerProfile(
    flags({ familyRules: family({ strollerAccess: true, napWindow: true, youngestBand: "infant" }) })
  );
  assert.match(out, /Travelling with an infant \(under 2\)/);
  assert.match(out, /step-free/);
  assert.match(out, /nap/);
});

test("the family pill with no band falls back to the wording it always had", () => {
  const out = formatTravelerProfile(flags({ familyRules: family({ youngestBand: null }) }));
  assert.match(out, /Travelling with kids: choose kid-friendly stops/);
  assert.doesNotMatch(out, /step-free/, "no infant was reported, so no stroller rule is invented");
});

// --- booked travel -----------------------------------------------------------------------------

const legs = (over) => ({
  arrivalTime: null,
  arrivalPoint: null,
  departureTime: null,
  departurePoint: null,
  stayBooked: null,
  ...over,
});

test("absent logistics leave the prompt byte-identical", () => {
  // The contract this whole module is built on: skipping an optional field must not change a
  // single byte of what the model sees.
  assert.equal(formatTravelLegs(null), "");
  assert.equal(formatTravelLegs(legs()), "", "an object of nulls is the same as no object");
});

test("an arrival carries its time, its place and the transfer buffer", () => {
  const out = formatTravelLegs(legs({ arrivalTime: "20:15", arrivalPoint: "Kansai Intl (KIX)" }));
  assert.match(out, /arrives on day 1 at 20:15 at Kansai Intl \(KIX\)/);
  assert.match(out, /90 minutes/);
  assert.doesNotMatch(out, /departs/, "a one-way answer must not invent the other leg");
});

test("a place without a time still says where, and claims no time", () => {
  const out = formatTravelLegs(legs({ arrivalPoint: "Kyoto Station" }));
  assert.match(out, /arrives on day 1 at Kyoto Station/);
  assert.doesNotMatch(out, /90 minutes/, "no landing time means no buffer to reserve");
});

test("a departure reserves the end of the last day", () => {
  const out = formatTravelLegs(legs({ departureTime: "09:40" }));
  assert.match(out, /departs on the last day at 09:40/);
  assert.match(out, /90 minutes/);
});

test("booked lodging tells the model to stop choosing one", () => {
  assert.match(formatTravelLegs(legs({ stayBooked: "Guesthouse in Gion" })), /already booked/);
});

test("the group reaches the prompt in words", () => {
  // Before this line existed the legacy prompt carried no group at all — "solo" and "couple"
  // never reached the model, and the free-text "other" description was collected and discarded.
  assert.match(formatTravelerProfile(flags()), /Travelling as: solo traveler/);
  assert.match(
    formatTravelerProfile(flags({ groupLabel: "five college friends" })),
    /Travelling as: five college friends/
  );
});
