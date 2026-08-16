/* Run: node --test src/lib/travelerProfilePrompt.test.mjs
 *
 * This block is the only path the traveler's answers take into the prompt, so
 * "says nothing when there is nothing to say" matters as much as what it emits:
 * a caller with no answers must leave the prompt byte-identical to before. */
import assert from "node:assert/strict";
import test from "node:test";
import { formatTravelerProfile } from "./travelerProfilePrompt.ts";

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
  ...over,
});

test("returns an empty string when there are no flags", () => {
  assert.equal(formatTravelerProfile(null), "");
});

test("always states the pace target", () => {
  const out = formatTravelerProfile(flags({ paceSpotsPerDay: 2, paceResolved: "slow" }));
  assert.match(out, /about 2 stops per day/);
  assert.match(out, /"slow"/);
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
