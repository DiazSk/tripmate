/* Run: npm test — which registers scripts/ts-resolve.mjs so these can import the app's .ts modules.
 *
 * The benchmark's scorers are the whole point of the harness — if they're wrong, every number on
 * the page is wrong in a way that looks authoritative. These asserts pin the behaviour that is
 * easy to break silently: the markdown parser's tolerance for surface variation, the opening-hours
 * reader's refusal to guess, and each scorer's counting rules (including the ones that deliberately
 * DON'T count something — Evening entries against daylight, under-run against the pace cap). */
import assert from "node:assert/strict";
import test from "node:test";

import {
  parseClock,
  parseDuration,
  parseItinerary,
  parseTimeWindow,
  parseTransport,
  dayEntries,
} from "./parseItinerary.ts";
import {
  hoursForWeekday,
  nameMatches,
  scoreConstraints,
  scoreCoverage,
  scoreFeasibility,
  scoreFormat,
  scoreGeoCoherence,
  scoreGrounding,
  usableSlot,
} from "./scorers/domain.ts";
import { cosine, scoreLexical } from "./scorers/text.ts";
import { compositeScore, paretoFrontier, balancedPanel, aggregateByModel } from "./runBenchmark.ts";
import { getFixture } from "./fixtures.ts";
import { toItineraryJson, countStops } from "./itineraryJson.ts";
import { shortestPathKm, scoreBacktrack, scoreMealProximity, scoreDowntime } from "./scorers/route.ts";
import { scoreWeatherAlignment, scoreBudget, scoreVibe, isAdverseDay, classifyExposure } from "./scorers/context.ts";
import { compositeGroups } from "./runBenchmark.ts";
import { COMPOSITE_WEIGHTS } from "./types.ts";

const KYOTO = getFixture("kyoto-couple-mixed");

const WELL_FORMED = `## Day 1 — 2026-09-19

*Southern shrines at first light, then a slow drift north through the old lanes. \u26e9\ufe0f\ud83c\udf62*

**Weather:** Warm and clear, 21-29C

**Lodging:** Machiya guesthouse in Gion — $210 — central to the day's cluster and quiet after dark

- **07:00 AM — Fushimi Inari Taisha** (entry, 2.5 hours, $0, 34.9671/135.7727)
  why: Dawn on the torii path is the one hour it is genuinely quiet.
  note: 20 min transit from the guesthouse; go before 08:00 to beat the tour buses.
- **10:00 AM — Kiyomizu-dera** (entry, 1.5 hours, $5, 34.9949/135.7850)
  why: Hillside veranda pairs with the morning's shrine without repeating it.
  note: 20 min transit from the last stop, then a short uphill walk.
- **01:00 PM — Nishiki Market** (food, 1 hour, $25, 35.0050/135.7648)
  why: Covered arcade lunch that suits a food-led day.
  note: 10 min walk from the last stop; stalls thin out after 17:00.
- **07:00 PM — Dinner around Pontocho Alley** (food, 1.5 hours, $60, 35.0044/135.7707)
  why: Riverside lanes are the evening the traveler came for.
  note: 15 min walk from the last stop; kaiseki and yakitori counters, e.g. small izakaya.

## Day 2 — 2026-09-20

*A northern loop at an easier pace, ending on the water. \ud83c\udf3f*

**Weather:** Mild with a chance of showers, 22-30C

- **09:00 AM — Kinkaku-ji** (entry, 45 minutes, $5, 35.0394/135.7292)
  why: Arriving at opening is the only way to see the pavilion uncrowded.
  note: 25 min transit from the guesthouse; go straight to the pond side.
- **12:30 PM — Lunch around Demachiyanagi** (food, 1 hour, $20, 35.0300/135.7720)
  why: Riverside canteens suit a slower second day.
  note: 20 min transit from the last stop; several counters along the arcade.
`;

// --- parser ------------------------------------------------------------------------------------

test("parseClock handles 24h and 12h forms", () => {
  assert.equal(parseClock("09:30"), 570);
  assert.equal(parseClock("9:30 AM"), 570);
  assert.equal(parseClock("9 PM"), 1260);
  assert.equal(parseClock("12:00 AM"), 0);
  assert.equal(parseClock("nonsense"), null);
});

test("parseTimeWindow accepts en dash, em dash, hyphen and 'to'", () => {
  for (const sep of ["–", "—", "-", " to "]) {
    assert.deepEqual(parseTimeWindow(`x 09:00${sep}11:00 y`), { startMin: 540, endMin: 660 });
  }
});

test("parseTimeWindow keeps a midnight-crossing span positive", () => {
  assert.deepEqual(parseTimeWindow("21:00–00:30"), { startMin: 1260, endMin: 1470 });
});

test("parseDuration reads minutes and hours", () => {
  assert.equal(parseDuration("x (~2.5h)"), 150);
  assert.equal(parseDuration("x (90 min)"), 90);
  assert.equal(parseDuration("x (1 hour)"), 60);
  assert.equal(parseDuration("x, no duration"), null);
});

test("parseTransport reads mode and minutes, normalizing to the app's vocabulary", () => {
  assert.deepEqual(parseTransport("→ 20 min metro to next stop").mode, "transit");
  assert.equal(parseTransport("→ 20 min metro to next stop").minutes, 20);
  assert.equal(parseTransport("-> walk, about 10 mins").mode, "walk");
  assert.equal(parseTransport("no arrow here"), null);
});

test("parseItinerary reads the skill's format end to end", () => {
  const parsed = parseItinerary(WELL_FORMED);
  assert.equal(parsed.days.length, 2);
  const day = parsed.days[0];
  assert.equal(day.date, "2026-09-19");
  assert.equal(day.dayOfWeek, "Sat", "§11's heading has no weekday, so it comes from the date");
  assert.ok(day.theme.startsWith("Southern shrines"));
  assert.ok(day.weather.includes("21-29C"));
  assert.equal(day.lodging.costUsd, 210);
  assert.ok(day.stayNear.startsWith("Machiya guesthouse"));
  assert.equal(dayEntries(day).length, 4);

  // Slots are derived from each start time now, not read from a heading.
  assert.equal(day.entriesBySlot.Morning.length, 2);
  assert.equal(day.entriesBySlot.Afternoon.length, 1);
  assert.equal(day.entriesBySlot.Evening.length, 1);

  const first = day.entriesBySlot.Morning[0];
  assert.equal(first.name, "Fushimi Inari Taisha");
  assert.equal(first.category, "entry");
  assert.equal(first.costUsd, 0, "a stated 0 is a real cost, not a missing one");
  assert.equal(first.durationMin, 150);
  assert.equal(first.window.startMin, 7 * 60);
  assert.ok(first.why.startsWith("Dawn on the torii"));
  assert.equal(first.lat, 34.9671);
  // §3c puts the leg in the note, so that's where the transport comes from.
  assert.equal(first.transport.mode, "transit");
  assert.equal(first.transport.minutes, 20);
  assert.equal(first.areaLevel, false);
  assert.equal(day.entriesBySlot.Evening[0].areaLevel, true, "an 'around <area>' meal is area-level");
  assert.equal(parsed.days[1].lodging, null, "§11 omits the Lodging line on the last day");
});

test("parseItinerary flags a code fence and still parses the body", () => {
  const parsed = parseItinerary("```markdown\n" + WELL_FORMED + "\n```");
  assert.equal(parsed.hadCodeFence, true);
  assert.equal(parsed.days.length, 2);
});

// --- opening hours ------------------------------------------------------------------------------

test("hoursForWeekday reads plain ranges, day lists and off clauses", () => {
  assert.deepEqual(hoursForWeekday("Mo-Su 09:00-17:00", "Wed"), { ranges: [[540, 1020]] });
  assert.deepEqual(hoursForWeekday("24/7", "Mon"), { ranges: [[0, 1440]] });
  assert.equal(hoursForWeekday("Tu-Su 08:45-17:00; Mo off", "Mon"), "closed");
  assert.deepEqual(hoursForWeekday("Tu-Su 08:45-17:00; Mo off", "Tue"), { ranges: [[525, 1020]] });
  assert.equal(hoursForWeekday("Sa-Su 09:00-18:00", "Wed"), "closed", "a day not listed is shut");
  assert.deepEqual(hoursForWeekday("Tu-Su 10:00-13:00,14:00-18:00; Mo off", "Thu"), {
    ranges: [[600, 780], [840, 1080]],
  });
});

test("hoursForWeekday returns null rather than guessing at syntax it can't read", () => {
  assert.equal(hoursForWeekday(null, "Mon"), null);
  assert.equal(hoursForWeekday('Mo-Su 09:00-17:00 "by appointment"', "Mon"), null);
  assert.equal(hoursForWeekday("Mo-Su 09:00-17:00; PH off", "Mon"), null);
});

// --- name matching -------------------------------------------------------------------------------

test("nameMatches tolerates the ways models rewrite a place name", () => {
  assert.equal(nameMatches("Kinkaku-ji", "Kinkaku-ji (Golden Pavilion)"), true);
  assert.equal(nameMatches("Fushimi Inari shrine", "Fushimi Inari Taisha"), true);
  assert.equal(nameMatches("Nishiki Market", "Nijo Castle"), false);
  assert.equal(nameMatches("", "Nijo Castle"), false);
});

// --- scorers -------------------------------------------------------------------------------------

test("scoreFormat passes a well-formed day and names what a broken one is missing", () => {
  const twoDayFixture = {
    ...KYOTO,
    reconciled: {
      ...KYOTO.reconciled,
      rawFetch: {
        ...KYOTO.reconciled.rawFetch,
        dateContext: { ...KYOTO.reconciled.rawFetch.dateContext, tripDays: 2 },
      },
    },
  };
  const good = scoreFormat(parseItinerary(WELL_FORMED), twoDayFixture);
  assert.equal(good.pass, true, JSON.stringify(good.missingFields));

  // Drop one stop's cost — the single field that made the §5 budget rule unmeasurable before §11.
  const noCost = WELL_FORMED.replace("(food, 1 hour, $25, 35.0050/135.7648)", "(food, 1 hour, 35.0050/135.7648)");
  const bad = scoreFormat(parseItinerary(noCost), twoDayFixture);
  assert.equal(bad.pass, false);
  assert.ok(bad.missingFields.includes("every stop has a cost"));
  assert.ok(bad.normalized > 0 && bad.normalized < 1, "a near-miss is not scored as a total failure");
});

test("scoreFeasibility counts overlapping windows", () => {
  const overlapping = `### 2026-09-19 (Sat) — x

**Morning**
- A — 09:00–12:00 (~3h)
- B — 11:00–13:00 (~2h)

**Afternoon**
- C — 14:00–15:00 (~1h)

**Evening**
- D — 19:00–20:00 (~1h)

**Stay near:** somewhere — why
`;
  const score = scoreFeasibility(parseItinerary(overlapping));
  assert.equal(score.overlaps, 1);
  assert.equal(score.overBudgetDays, 0);
});

test("scoreFeasibility flags a day that exceeds the waking-hours budget", () => {
  const marathon = `### 2026-09-19 (Sat) — x

**Morning**
- A — 06:00–12:00 (~6h)
  → 60 min transit to next stop

**Afternoon**
- B — 13:00–19:00 (~6h)
  → 60 min transit to next stop

**Evening**
- C — 20:00–23:00 (~3h)

**Stay near:** somewhere — why
`;
  const score = scoreFeasibility(parseItinerary(marathon));
  assert.equal(score.overBudgetDays, 1, "15h of activity + 2h travel is past a 14h budget");
});

test("scoreConstraints counts a pace over-run but not an under-run", () => {
  // Kyoto resolves to 3 stops/day (mixed ceiling 4, moderate energy -1).
  assert.equal(KYOTO.reconciled.resolvedFlags.paceSpotsPerDay, 3);

  const over = `### 2026-09-19 (Sat) — x

**Morning**
- Fushimi Inari Taisha — 07:00–08:00 (~1h)
- Kinkaku-ji — 09:00–10:00 (~1h)

**Afternoon**
- Kiyomizu-dera — 12:00–13:00 (~1h)
- Nijo Castle — 14:00–15:00 (~1h)

**Evening**
- Gion district — 18:00–19:00 (~1h)

**Stay near:** somewhere — why
`;
  const overScore = scoreConstraints(parseItinerary(over), KYOTO);
  assert.equal(overScore.byType.pace, 1, "5 named stops against a 3/day target is one breach");

  const under = `### 2026-09-19 (Sat) — x

**Morning**
- Fushimi Inari Taisha — 07:00–08:00 (~1h)

**Afternoon**
- Kiyomizu-dera — 12:00–13:00 (~1h)

**Evening**
- Dinner around Gion — 18:00–19:00 — izakaya

**Stay near:** somewhere — why
`;
  const underScore = scoreConstraints(parseItinerary(under), KYOTO);
  assert.equal(underScore.byType.pace, 0, "the skill states a cap, so a short day is not a breach");
  assert.equal(underScore.checkedByType.pace, 1, "but it was still checked");
});

test("scoreConstraints catches a closed-day booking and reports its reason", () => {
  // Nijo Castle is "Tu-Su 08:45-17:00; Mo off" — 2026-09-21 is a Monday.
  const monday = `### 2026-09-21 (Mon) — x

**Morning**
- Nijo Castle — 09:00–11:00 (~2h)

**Afternoon**
- Kiyomizu-dera — 13:00–14:00 (~1h)

**Evening**
- Dinner around Gion — 18:00–19:00 — izakaya

**Stay near:** somewhere — why
`;
  const score = scoreConstraints(parseItinerary(monday), KYOTO);
  assert.equal(score.byType.opening_hours, 1);
  assert.ok(score.details.some((d) => d.detail.includes("Nijo Castle")));
});

test("scoreConstraints exempts stops that do not depend on daylight", () => {
  // Day 1 sunset is 17:56, so a 19:00 evening entry is after dark — and allowed by skill §5.
  const evening = `## Day 1 — 2026-09-19

*x*

**Weather:** clear

- **07:00 AM — Fushimi Inari Taisha** (entry, 1 hour, $0, 34.9671/135.7727)
  why: dawn on the torii path
  note: 10 min walk from the guesthouse
- **01:00 PM — Kiyomizu-dera** (entry, 1 hour, $5, 34.9949/135.7850)
  why: hillside veranda
  note: 20 min transit from the last stop
- **07:00 PM — Dinner around Pontocho** (food, 1.5 hours, $50, 35.0044/135.7707)
  why: riverside lanes after dark
  note: 15 min walk from the last stop
`;
  const score = scoreConstraints(parseItinerary(evening), KYOTO);
  assert.equal(score.byType.daylight, 0, "a dinner after sunset does not need daylight");

  // Same 19:30 hour, but an outdoor temple rather than a meal — that one does breach §10. The old
  // version of this test varied the slot heading; slots are derived from the clock now, so what
  // has to vary is the kind of stop.
  const templeAfterDark = evening.replace(
    "- **01:00 PM — Kiyomizu-dera** (entry, 1 hour, $5, 34.9949/135.7850)",
    "- **07:30 PM — Kiyomizu-dera** (entry, 1 hour, $5, 34.9949/135.7850)"
  );
  const late = scoreConstraints(parseItinerary(templeAfterDark), KYOTO);
  assert.equal(late.byType.daylight, 1, "an outdoor temple after sunset does breach it");
});

test("scoreCoverage measures starred priorities and pinned anchors separately", () => {
  const score = scoreCoverage(parseItinerary(WELL_FORMED), KYOTO);
  assert.equal(score.starredTotal, 2, "history + food");
  assert.equal(score.anchorsTotal, 4);
  assert.ok(score.anchorsIncluded >= 2, "the sample names Fushimi Inari and Kiyomizu-dera");
  assert.ok(score.missingAnchors.includes("Nijo Castle"));
});

test("scoreGeoCoherence reports its own denominator", () => {
  const score = scoreGeoCoherence(parseItinerary(WELL_FORMED), KYOTO);
  assert.equal(score.totalLegs, 4, "4 entries on day 1 and 2 on day 2 make 3 + 1 pairs");
  assert.ok(score.matchedLegs > 0 && score.matchedLegs <= score.totalLegs);
  assert.ok(score.tripMeanMinutes > 0);
  assert.ok(score.normalized >= 0 && score.normalized <= 1);
});

test("scoreGrounding separates unlisted stops from context contradictions", () => {
  const invented = `### 2026-09-19 (Sat) — x

**Morning**
- Cafe Somewhere Invented — 08:00–09:00 (~1h)

**Afternoon**
- Kiyomizu-dera — 13:00–14:00 (~1h)

**Evening**
- Dinner around Gion — 18:00–19:00 — izakaya

**Stay near:** somewhere — why
`;
  const score = scoreGrounding(parseItinerary(invented), KYOTO);
  assert.equal(score.namedStops, 2, "the area-level dinner is not a named stop");
  assert.equal(score.unlistedStops, 1);
  assert.equal(
    score.contextContradictions,
    0,
    "choosing an unlisted stop is what the skill asks for, not a hallucination"
  );
  assert.equal(score.normalized, 1);
});

// --- text --------------------------------------------------------------------------------------

test("scoreLexical produces sane statistics on list-shaped text", () => {
  const score = scoreLexical(WELL_FORMED);
  assert.ok(score.words > 30);
  assert.ok(score.typeTokenRatio > 0 && score.typeTokenRatio <= 1);
  assert.ok(score.bigramRepetitionRate >= 0 && score.bigramRepetitionRate <= 1);
  assert.ok(
    score.fleschKincaidGrade > 0 && score.fleschKincaidGrade < 30,
    `bullets must count as sentences, got ${score.fleschKincaidGrade}`
  );
});

test("cosine is 1 for identical text and lower for unrelated text", () => {
  assert.ok(Math.abs(cosine(WELL_FORMED, WELL_FORMED) - 1) < 1e-9);
  assert.ok(cosine(WELL_FORMED, "quarterly revenue depreciation schedule") < 0.2);
});

// --- aggregation ---------------------------------------------------------------------------------

test("paretoFrontier keeps only the undominated points", () => {
  const frontier = paretoFrontier([
    { model: "cheap-ok", quality: 0.7, cost: 0.01 },
    { model: "pricey-best", quality: 0.9, cost: 0.2 },
    { model: "pricey-worse", quality: 0.6, cost: 0.3 },
    { model: "unpriced", quality: 0.99, cost: null },
  ]);
  assert.equal(frontier.has("cheap-ok"), true);
  assert.equal(frontier.has("pricey-best"), true);
  assert.equal(frontier.has("pricey-worse"), false, "worse quality AND higher cost is dominated");
  assert.equal(frontier.has("unpriced"), false, "an unpriced model can't be placed on the frontier");
});

test("compositeScore refuses to score a cell with too few measurable groups", () => {
  const nothing = {
    geoCoherence: { normalized: null }, backtrack: { normalized: null },
    constraints: { normalized: 1 },
    weather: { normalized: null }, feasibility: { normalized: null }, downtime: { normalized: null },
    mealProximity: { normalized: null }, vibe: { normalized: null },
    coverage: { normalized: null }, grounding: { normalized: null },
  };
  // Only one of five groups is measurable — not enough to call anything a quality score.
  assert.equal(compositeScore(nothing), null);

  const three = { ...nothing, coverage: { normalized: 1 }, mealProximity: { normalized: 1 } };
  assert.ok(compositeScore(three) !== null, "three measurable groups is enough");
});

// --- structured output ---------------------------------------------------------------------------

test("toItineraryJson mirrors the readable plan and carries the model's own costs", () => {
  const json = toItineraryJson(WELL_FORMED, KYOTO, "test-model");

  assert.equal(json.model, "test-model");
  assert.equal(json.days.length, 2);
  assert.equal(countStops(json), 6);

  const day = json.days[0];
  assert.equal(day.date, "2026-09-19");
  assert.equal(day.dayOfWeek, "Sat");
  assert.ok(day.stayNear.startsWith("Machiya guesthouse"));
  assert.equal(day.lodging.costUsd, 210);
  assert.equal(json.days[1].lodging, null, "§11 omits lodging on the last day");

  // Weather comes from the trip bundle, not the model's prose — the fixture's day-1 forecast.
  assert.equal(day.weather.tempMaxC, 29);
  assert.equal(day.weather.sunset, "17:56");
  assert.equal(day.weather.estimated, false);

  const first = day.stops[0];
  assert.equal(first.name, "Fushimi Inari Taisha");
  assert.equal(first.slot, "Morning");
  assert.equal(first.startTime, "07:00");
  assert.equal(first.durationMinutes, 150);
  assert.equal(first.transportToNext.mode, "transit");
  assert.equal(first.transportToNext.minutes, 20);
  assert.equal(first.category, "entry", "§11's own category field, not the lexical guess");
  assert.equal(first.costUsd, 0, "a stated 0 survives as 0, not as null");
  assert.equal(first.matchedPoi, "Fushimi Inari Taisha");
  assert.ok(typeof first.lat === "number", "coordinates come from the matched POI");

  const dinner = day.stops.at(-1);
  assert.equal(dinner.areaLevel, true);
  assert.equal(dinner.category, "food");
  assert.equal(dinner.costUsd, 60);
  assert.ok(typeof dinner.lat === "number", "an unmatched area falls back to the model's own pair");

  // A stop that states no cost stays null rather than becoming 0.
  const noCost = WELL_FORMED.replace("(entry, 2.5 hours, $0, 34.9671/135.7727)", "(entry, 2.5 hours, 34.9671/135.7727)");
  assert.equal(toItineraryJson(noCost, KYOTO, "m").days[0].stops[0].costUsd, null);

  assert.equal(json.omittedFields.some((f) => f.startsWith("stop.cost")), false, "costs are carried now");
});

test("toItineraryJson normalizes 12h clocks into the structured payload", () => {
  const twelveHour = WELL_FORMED.replace("07:00–09:30", "7:00 AM – 9:30 AM");
  const json = toItineraryJson(twelveHour, KYOTO, "m");
  assert.equal(json.days[0].stops[0].time, "07:00-09:30");
});

test("toItineraryJson falls back to the trip's own calendar when a heading has no date", () => {
  const noDate = WELL_FORMED.replace("### 2026-09-19 (Sat) —", "### Day One —");
  const json = toItineraryJson(noDate, KYOTO, "m");
  assert.equal(json.days[0].date, "2026-09-19", "position in the trip supplies the date");
});

// --- booked logistics consume slots ---------------------------------------------------------------

/** A trip whose traveler lands mid-afternoon on day 1 and flies out mid-morning on the last day. */
function withLogistics(arrivalTime, departureTime) {
  return {
    ...KYOTO,
    reconciled: {
      ...KYOTO.reconciled,
      userAnswers: { ...KYOTO.reconciled.userAnswers, logistics: { arrivalTime, departureTime, stayBooked: null } },
    },
  };
}

test("a booked arrival consumes the slots it lands in, and only on day 1", () => {
  const f = withLogistics("14:30", null);
  // Landed 14:30 + 90 min transfer: morning is gone, afternoon is partly gone but still plannable.
  assert.equal(usableSlot("Morning", 0, 4, f), false);
  assert.equal(usableSlot("Afternoon", 0, 4, f), true);
  assert.equal(usableSlot("Evening", 0, 4, f), true);
  // Every later day is untouched.
  assert.equal(usableSlot("Morning", 1, 4, f), true);
});

test("a booked departure consumes the tail of the last day only", () => {
  const f = withLogistics(null, "11:00");
  const last = 3;
  assert.equal(usableSlot("Morning", last, 4, f), true);
  assert.equal(usableSlot("Afternoon", last, 4, f), false);
  assert.equal(usableSlot("Evening", last, 4, f), false);
  assert.equal(usableSlot("Afternoon", 0, 4, f), true, "the first day keeps its afternoon");
});

test("with no booked logistics every slot is expected", () => {
  for (const slot of ["Morning", "Afternoon", "Evening"]) {
    assert.equal(usableSlot(slot, 0, 3, KYOTO), true);
  }
});

test("usableSlot reads a booked arrival as consuming the morning it lands in", () => {
  // §11 has no slot blocks, so format_adherence no longer scores slot coverage — but the arrival
  // and departure boundaries this encodes still govern feasibility and skill §4c-bis, so the helper
  // stays covered. A 14:30 arrival plus the 90-minute transfer buffer eats day 1's morning.
  const arriving = withLogistics("14:30", null);
  assert.equal(usableSlot("Morning", 0, 3, arriving), false);
  assert.equal(usableSlot("Evening", 0, 3, arriving), true);
  assert.equal(usableSlot("Morning", 1, 3, arriving), true, "only day 1 is affected");

  const leaving = withLogistics(null, "10:00");
  assert.equal(usableSlot("Afternoon", 2, 3, leaving), false, "a 10:00 departure ends the last day");
  assert.equal(usableSlot("Morning", 2, 3, leaving), true);

  assert.equal(usableSlot("Morning", 0, 3, KYOTO), true, "no booking means every slot is usable");
});

// --- balanced panel --------------------------------------------------------------------------------

const cell = (fixtureId, model) => ({
  fixtureId,
  model,
  composite: 0.5,
  scores: {
    operational: { failed: false, latencyMs: 1, inputTokens: 1, outputTokens: 1, costUsd: 1, cliReportedCostUsd: null },
    constraints: { byType: {}, normalized: 0.5 },
    grounding: { unlistedRate: 0, contradictionRate: 0, normalized: 1 },
    semantic: { relevance: 0.5 },
    format: { pass: true, normalized: 1 },
    lexical: { words: 1, typeTokenRatio: 1, bigramRepetitionRate: 0, fleschKincaidGrade: 1 },
    geoCoherence: { normalized: 0.5 },
    coverage: { normalized: 0.5 },
    feasibility: { normalized: 1 },
    backtrack: { normalized: 1, perDayExcessKm: [] },
    mealProximity: { normalized: 1, detours: [] },
    downtime: { normalized: 1, tightDays: [] },
    weather: { normalized: null, applicable: false },
    budget: { normalized: 1, withinBudget: true, estimatedUsd: 10 },
    vibe: { normalized: 1, jaccard: 1 },
    judge: null,
  },
});

test("balancedPanel only counts a trip once every model has planned it", () => {
  const models = ["a", "b", "c"];
  const cells = [
    cell("trip1", "a"), cell("trip1", "b"), cell("trip1", "c"),
    cell("trip2", "a"), cell("trip2", "b"),
    cell("trip3", "a"),
  ];
  const { included, excluded } = balancedPanel(cells, models);
  assert.deepEqual(included, ["trip1"]);
  assert.deepEqual(excluded.sort(), ["trip2", "trip3"]);
});

test("aggregateByModel never averages models over different trip sets", () => {
  const models = ["a", "b"];
  // Model "a" is a trip ahead — the exact mid-sweep state that made the old aggregate lie.
  const cells = [cell("trip1", "a"), cell("trip1", "b"), cell("trip2", "a")];
  const aggs = aggregateByModel(cells, models);
  assert.equal(aggs.length, 2);
  for (const a of aggs) {
    assert.equal(a.cells, 1, `${a.model} must be averaged over the shared trip only`);
  }
});

test("aggregateByModel keeps a row for a model that has not run at all", () => {
  const aggs = aggregateByModel([cell("trip1", "a")], ["a", "b"]);
  assert.deepEqual(aggs.map((x) => x.model).sort(), ["a", "b"]);
  // No trip is complete (b never ran), so nothing is comparable yet.
  for (const a of aggs) assert.equal(a.cells, 0);
});

// --- added metrics: route geometry ----------------------------------------------------------------

test("shortestPathKm finds the optimal open path, not a cycle", () => {
  // Four points on a line: 0, 1, 2, 3 (degrees of longitude at the equator).
  const pts = [0, 1, 2, 3].map((lon) => ({ name: String(lon), lat: 0, lon }));
  const straight = shortestPathKm(pts);
  assert.equal(straight.exact, true);

  // Walking them in order IS optimal, so an in-order path must equal the solver's answer.
  const inOrder = shortestPathKm([pts[0], pts[1], pts[2], pts[3]]);
  assert.ok(Math.abs(inOrder.km - straight.km) < 1e-6);

  // The solver must not be fooled by the input ordering — a scrambled input has the same optimum.
  const scrambled = shortestPathKm([pts[2], pts[0], pts[3], pts[1]]);
  assert.ok(Math.abs(scrambled.km - straight.km) < 1e-6, "optimum is order-independent");
});

test("shortestPathKm degenerates safely", () => {
  assert.equal(shortestPathKm([]).km, 0);
  assert.equal(shortestPathKm([{ name: "a", lat: 0, lon: 0 }]).km, 0);
});

test("scoreBacktrack scores an in-order day 1.0 and a zig-zag below it", () => {
  // Kyoto anchors, deliberately ordered north-to-south vs scrambled.
  const good = `### 2026-09-19 (Sat) — x

**Morning**
- Kinkaku-ji — 09:00–10:00 (~1h)
- Nijo Castle — 11:00–12:00 (~1h)

**Afternoon**
- Kiyomizu-dera — 13:00–14:00 (~1h)

**Evening**
- Fushimi Inari Taisha — 16:00–17:00 (~1h)

**Stay near:** somewhere — why
`;
  const zig = `### 2026-09-19 (Sat) — x

**Morning**
- Fushimi Inari Taisha — 09:00–10:00 (~1h)
- Kinkaku-ji — 11:00–12:00 (~1h)

**Afternoon**
- Kiyomizu-dera — 13:00–14:00 (~1h)

**Evening**
- Nijo Castle — 16:00–17:00 (~1h)

**Stay near:** somewhere — why
`;
  const g = scoreBacktrack(parseItinerary(good), KYOTO);
  const z = scoreBacktrack(parseItinerary(zig), KYOTO);
  assert.equal(g.scoredDays, 1);
  assert.ok(g.normalized > z.normalized, `ordered ${g.normalized} should beat zig-zag ${z.normalized}`);
  assert.ok(z.normalized < 1, "a zig-zag cannot be optimal");
  assert.ok(z.worstDay.actualKm > z.worstDay.optimalKm);
});

test("scoreBacktrack skips days with too few located stops rather than scoring them perfect", () => {
  const sparse = `### 2026-09-19 (Sat) — x

**Morning**
- Kinkaku-ji — 09:00–10:00 (~1h)

**Afternoon**
- Dinner around Gion — 13:00–14:00 — food

**Evening**
- Somewhere Invented — 18:00–19:00 (~1h)

**Stay near:** somewhere — why
`;
  const s = scoreBacktrack(parseItinerary(sparse), KYOTO);
  assert.equal(s.scoredDays, 0);
  assert.equal(s.normalized, null, "no ordering to judge means null, not 1.0");
});

test("scoreDowntime flags a wall-to-wall day and passes one with slack", () => {
  const packed = `### 2026-09-19 (Sat) — x

**Morning**
- A — 09:00–12:00 (~3h)
  → 15 min walk to next stop

**Afternoon**
- B — 12:15–17:00 (~4.75h)

**Evening**
- C — 17:00–20:00 (~3h)

**Stay near:** somewhere — why
`;
  const packedScore = scoreDowntime(parseItinerary(packed));
  assert.equal(packedScore.scoredDays, 1);
  assert.equal(packedScore.passedDays, 0);
  assert.equal(packedScore.tightDays.length, 1);

  const roomy = `### 2026-09-19 (Sat) — x

**Morning**
- A — 09:00–10:00 (~1h)

**Afternoon**
- B — 13:00–14:00 (~1h)

**Evening**
- C — 18:00–19:00 (~1h)

**Stay near:** somewhere — why
`;
  const roomyScore = scoreDowntime(parseItinerary(roomy));
  assert.equal(roomyScore.passedDays, 1);
  assert.equal(roomyScore.normalized, 1);
});

test("scoreMealProximity flags a meal that is a detour", () => {
  const md = `## Day 1 — 2026-09-19

*x*

**Weather:** clear

- **09:00 AM — Kinkaku-ji** (entry, 1 hour, $5, 35.0394/135.7292)
  why: golden pavilion at opening
  note: 15 min transit from the guesthouse
- **12:30 PM — Lunch around Higashiyama** (food, 1 hour, $20, 34.9980/135.7820)
  why: teahouse lanes
  note: 45 min transit from the last stop — right across the city
- **07:00 PM — Dinner around Gion** (food, 1 hour, $45, 35.0037/135.7752)
  why: izakaya lanes
  note: 10 min walk from the last stop
`;
  const s = scoreMealProximity(parseItinerary(md), KYOTO);
  assert.ok(s.mealSlots >= 2);
  assert.ok(s.measured >= 1, "the stated 45 min leg is measurable");
  assert.ok(s.detours.some((d) => d.minutes === 45));
  assert.ok(s.normalized < 1);
});

// --- added metrics: context ------------------------------------------------------------------------

test("isAdverseDay triggers on heavy rain and extreme temperatures only", () => {
  assert.equal(isAdverseDay({ precipitationProbability: 80, tempMinC: 15, tempMaxC: 22 }).adverse, true);
  assert.equal(isAdverseDay({ precipitationProbability: 20, tempMinC: 15, tempMaxC: 22 }).adverse, false);
  assert.equal(isAdverseDay({ precipitationProbability: 0, tempMinC: -5, tempMaxC: 2 }).adverse, true);
  assert.equal(isAdverseDay({ precipitationProbability: 0, tempMinC: 25, tempMaxC: 38 }).adverse, true);
});

test("scoreWeatherAlignment penalises outdoor stops on the rainy day only", () => {
  // Kyoto fixture day 3 (index 2, 2026-09-21) is the 80%-rain day.
  const outdoorOnRain = `### 2026-09-19 (Sat) — a

**Morning**
- Kinkaku-ji — 09:00–10:00 (~1h)

**Afternoon**
- Nijo Castle — 13:00–14:00 (~1h)

**Evening**
- Dinner around Gion — 19:00–20:00 — food

**Stay near:** x — y

### 2026-09-20 (Sun) — b

**Morning**
- Kinkaku-ji — 09:00–10:00 (~1h)

**Afternoon**
- Nijo Castle — 13:00–14:00 (~1h)

**Evening**
- Dinner around Gion — 19:00–20:00 — food

**Stay near:** x — y

### 2026-09-21 (Mon) — c

**Morning**
- Arashiyama Bamboo Grove — 09:00–10:00 (~1h)

**Afternoon**
- Kyoto Railway Museum — 13:00–14:00 (~1h)

**Evening**
- Dinner around Gion — 19:00–20:00 — food

**Stay near:** x — y
`;
  const s = scoreWeatherAlignment(parseItinerary(outdoorOnRain), KYOTO);
  assert.equal(s.applicable, true);
  assert.equal(s.adverseDays, 1, "only 2026-09-21 exceeds 60% rain");
  assert.ok(s.outdoorOnAdverseDays >= 1, "the bamboo grove is outdoors");
  assert.ok(s.violations.every((v) => v.dayIndex === 2), "only the rainy day yields violations");
  assert.ok(s.normalized < 1);
});

test("scoreWeatherAlignment returns null — not 1.0 — when no day is adverse", () => {
  const lisbon = getFixture("lisbon-solo-offbeat"); // max 40% rain
  const s = scoreWeatherAlignment(parseItinerary(WELL_FORMED), lisbon);
  assert.equal(s.applicable, false);
  assert.equal(s.normalized, null, "a model must not be rewarded for a test never run");
});

test("classifyExposure reads kinds first, then words, and admits ignorance", () => {
  const entry = (name) => ({ name, raw: name, areaLevel: false, slot: "Morning", window: null, durationMin: null, transport: null });
  assert.equal(classifyExposure(entry("Arashiyama Bamboo Grove"), KYOTO), "outdoor");
  assert.equal(classifyExposure(entry("Kyoto Railway Museum"), KYOTO), "indoor");
  assert.equal(classifyExposure(entry("Some Unnamed Thing"), KYOTO), "unknown");
  // Ambiguous by design: a market may or may not have a roof, so it must not be called outdoor.
  assert.notEqual(classifyExposure(entry("Lunch at the market"), KYOTO), "outdoor");
  assert.notEqual(classifyExposure(entry("Walk to the gallery"), KYOTO), "outdoor");
});

test("scoreBudget reads stated costs, and penalises underspend as well as overspend", () => {
  // §11 puts a $cost on every stop and on the lodging line, so this is the model's own arithmetic
  // rather than the estimate table. WELL_FORMED totals $90 of stops + $210 lodging = $300.
  const cheap = scoreBudget(parseItinerary(WELL_FORMED), KYOTO); // $2600 budget
  assert.equal(cheap.estimateBased, false, "stated costs beat the estimate table");
  assert.equal(cheap.estimatedUsd, 325, "$115 of stops across both days + $210 lodging");
  assert.equal(cheap.withinBudget, true);
  assert.ok(cheap.budgetUsedFraction < 0.2);
  assert.ok(
    cheap.normalized > 0 && cheap.normalized < 1,
    "§5 asks for 85-100% of the budget, so spending a tenth of it is a miss too"
  );

  const tiny = { ...KYOTO, reconciled: { ...KYOTO.reconciled, userAnswers: { ...KYOTO.reconciled.userAnswers, budget: 100 } } };
  const over = scoreBudget(parseItinerary(WELL_FORMED), tiny);
  assert.equal(over.withinBudget, false);
  assert.ok(over.normalized > 0 && over.normalized < 1, "over-budget is proportional, not zero");

  const onTarget = { ...KYOTO, reconciled: { ...KYOTO.reconciled, userAnswers: { ...KYOTO.reconciled.userAnswers, budget: 350 } } };
  assert.equal(scoreBudget(parseItinerary(WELL_FORMED), onTarget).normalized, 1, "$325 of $350 is in band");

  // No costs in the output at all — the estimate table is still the fallback.
  const stripped = WELL_FORMED.replace(/\$\d+, /g, "").replace(/ — \$210 —/, " —");
  const estimated = scoreBudget(parseItinerary(stripped), KYOTO);
  assert.equal(estimated.estimateBased, true);
  assert.ok(estimated.excludes.includes("lodging"));
});

test("scoreVibe rewards stops carrying the traveler's tags", () => {
  const s = scoreVibe(parseItinerary(WELL_FORMED), KYOTO); // starred: Culture & History, Food
  assert.ok(s.classifiedStops > 0);
  assert.ok(s.normalized > 0.5, `expected most stops on-brief, got ${s.normalized}`);
  assert.ok(s.tripTags.includes("Culture & History"));
  assert.ok(s.jaccard !== null);
});

// --- composite ----------------------------------------------------------------------------------

test("composite weights are the specified five and sum to 1", () => {
  const sum = Object.values(COMPOSITE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
  assert.equal(COMPOSITE_WEIGHTS.routeEfficiency, 0.15);
  assert.equal(COMPOSITE_WEIGHTS.constraintAdherence, 0.25);
  assert.equal(COMPOSITE_WEIGHTS.weatherFeasibility, 0.15);
  assert.equal(COMPOSITE_WEIGHTS.mealVibeAlignment, 0.15);
  assert.equal(COMPOSITE_WEIGHTS.coverageGrounding, 0.3);
});

test("compositeScore renormalizes over measurable groups instead of scoring the gap as zero", () => {
  const perfect = {
    geoCoherence: { normalized: 1 }, backtrack: { normalized: 1 },
    constraints: { normalized: 1 },
    weather: { normalized: null }, feasibility: { normalized: 1 }, downtime: { normalized: 1 },
    mealProximity: { normalized: 1 }, vibe: { normalized: 1 },
    coverage: { normalized: 1 }, grounding: { normalized: 1 },
  };
  // Weather is null (sunny trip) but every other part is perfect — the composite must be 1.0,
  // not 0.85, or every fair-weather trip is silently capped.
  assert.equal(compositeScore(perfect), 1);

  const groups = compositeGroups(perfect);
  assert.equal(groups.weatherFeasibility, 1, "the group survives on its measurable parts");
});

test("compositeScore weights constraint adherence more heavily than route efficiency", () => {
  const base = () => ({
    geoCoherence: { normalized: 1 }, backtrack: { normalized: 1 },
    constraints: { normalized: 1 },
    weather: { normalized: 1 }, feasibility: { normalized: 1 }, downtime: { normalized: 1 },
    mealProximity: { normalized: 1 }, vibe: { normalized: 1 },
    coverage: { normalized: 1 }, grounding: { normalized: 1 },
  });
  const badRoute = base(); badRoute.geoCoherence = { normalized: 0 }; badRoute.backtrack = { normalized: 0 };
  const badConstraints = base(); badConstraints.constraints = { normalized: 0 };
  assert.ok(
    compositeScore(badConstraints) < compositeScore(badRoute),
    "25% constraint weight must bite harder than 15% route weight"
  );
});
