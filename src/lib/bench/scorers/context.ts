import { dayEntries } from "../parseItinerary";
import { nameMatches } from "./domain";
import type { BenchFixture } from "../fixtures";
import type { ParsedEntry, ParsedItinerary } from "../parseItinerary";
import type { BudgetScore, VibeScore, WeatherAlignmentScore } from "../types";

/**
 * Scorers that judge the itinerary against the trip's own context — weather, budget, persona.
 *
 * Two of these are honest about resting on assumptions, and the UI labels them accordingly:
 *
 * - `weather_alignment_score` needs to know whether a stop is outdoors. Nothing in the pipeline
 *   records that, so it's inferred from the POI's OpenTripMap `kinds` plus name keywords, and any
 *   stop it can't classify is excluded from the denominator rather than guessed at.
 * - `budget_accuracy_score` needs prices. THE PIPELINE HAS NONE — the staged path never asks the
 *   model for costs and the trip context carries no fares. So it prices stops from a category
 *   table of rough estimates below. That makes it an ESTIMATE, not a measurement, and it is
 *   labelled that way everywhere it appears.
 */

// --- outdoor / indoor classification ---------------------------------------------------------------

/** OpenTripMap-style `kinds` that put a stop outdoors. */
const OUTDOOR_KINDS = /\b(natural|beaches|gardens|parks|view_points|geological|water|bridges|urban_environment)\b/i;
/** `kinds` that put it under a roof. */
const INDOOR_KINDS = /\b(museums|galleries|theatres_and_entertainments|shops|malls|foods|cinemas)\b/i;

const OUTDOOR_WORDS =
  /\b(park|garden|trail|hike|hiking|stroll|beach|lake|river|riverside|waterfront|viewpoint|lookout|vista|grove|forest|mountain|summit|bridge|square|plaza|promenade|pier|harbour|harbor|open-air|outdoor|cruise|boat|terrace|rooftop)\b/i;

/**
 * Deliberately NOT treated as outdoor keywords, despite the temptation:
 *  - "market" — Nishiki is a covered arcade, Chatuchak is open air. A real false positive showed
 *    up in a live run: Sonnet was flagged for putting "Lunch at the market" on an 80%-rain day in
 *    Kyoto, where the market has a roof. It now falls through to the POI's `kinds` instead.
 *  - "walk" — appears in "walk to the museum" as often as in "riverside walk", so it says more
 *    about transport than about exposure.
 * Both land as `unknown`, which excludes them from the denominator rather than scoring them wrong.
 */
const INDOOR_WORDS =
  /\b(museum|gallery|aquarium|cathedral|church|chapel|palace interior|library|bookshop|bookstore|shop|mall|arcade|cellar|spa|onsen|bath|restaurant|cafe|café|bar|theatre|theater|cinema|hall|centre|center)\b/i;

export type Exposure = "outdoor" | "indoor" | "unknown";

/** Best-effort exposure for a stop. `unknown` is a real answer and is excluded from scoring. */
export function classifyExposure(entry: ParsedEntry, fixture: BenchFixture): Exposure {
  const candidates = fixture.reconciled.rawFetch.candidatePois.pois;
  const match = candidates.find((p) => nameMatches(entry.name, p.name));
  const kinds = match?.category ?? null;

  if (kinds && OUTDOOR_KINDS.test(kinds)) return "outdoor";
  if (kinds && INDOOR_KINDS.test(kinds)) return "indoor";

  // Name keywords: check indoor first, since "riverside museum" is a museum you can shelter in.
  if (INDOOR_WORDS.test(entry.name)) return "indoor";
  if (OUTDOOR_WORDS.test(entry.name)) return "outdoor";
  return "unknown";
}

// --- weather_alignment_score -----------------------------------------------------------------------

/** Above this chance of rain, a day is adverse and outdoor stops need justifying. */
export const ADVERSE_PRECIPITATION_PCT = 60;
/** Temperatures outside this band count as extreme. */
export const EXTREME_TEMP_C = { min: 0, max: 35 };

export function isAdverseDay(w: {
  precipitationProbability: number | null;
  tempMinC: number;
  tempMaxC: number;
}): { adverse: boolean; reason: string } {
  if ((w.precipitationProbability ?? 0) > ADVERSE_PRECIPITATION_PCT) {
    return { adverse: true, reason: `${w.precipitationProbability}% rain` };
  }
  if (w.tempMaxC >= EXTREME_TEMP_C.max) return { adverse: true, reason: `${w.tempMaxC}°C high` };
  if (w.tempMinC <= EXTREME_TEMP_C.min) return { adverse: true, reason: `${w.tempMinC}°C low` };
  return { adverse: false, reason: "" };
}

/**
 * weather_alignment_score — did the model move activities indoors when the forecast said to?
 *
 * Skill §5: "schedule outdoor POIs on days marked clear; schedule indoor POIs on days marked poor
 * weather." Scored only over days the fixture actually flags as adverse, and only over stops whose
 * exposure can be classified. A trip with no bad-weather days returns `null` — "not applicable" —
 * rather than a free 1.0, because rewarding a model for a rule it was never tested against would
 * quietly inflate every sunny trip.
 */
export function scoreWeatherAlignment(
  itinerary: ParsedItinerary,
  fixture: BenchFixture
): WeatherAlignmentScore {
  const forecast = fixture.reconciled.rawFetch.weather;
  if (!forecast.available) {
    return {
      adverseDays: 0,
      classifiedStops: 0,
      outdoorOnAdverseDays: 0,
      violations: [],
      applicable: false,
      reason: "no weather data for this trip",
      normalized: null,
    };
  }

  let adverseDays = 0;
  let classifiedStops = 0;
  let outdoorOnAdverseDays = 0;
  const violations: { dayIndex: number; name: string; reason: string; noted: boolean }[] = [];

  itinerary.days.forEach((day, dayIndex) => {
    const w = forecast.days[dayIndex];
    if (!w) return;
    const { adverse, reason } = isAdverseDay(w);
    if (!adverse) return;
    adverseDays++;

    // The skill's degradation path: naming the weather in the day's Note is part of handling it.
    const noted = /\b(rain|wet|shower|storm|indoor|cover|umbrella|heat|cold|snow|weather)\b/i.test(
      day.note ?? ""
    );

    for (const entry of dayEntries(day)) {
      const exposure = classifyExposure(entry, fixture);
      if (exposure === "unknown") continue;
      classifiedStops++;
      if (exposure === "outdoor") {
        outdoorOnAdverseDays++;
        violations.push({ dayIndex, name: entry.name, reason, noted });
      }
    }
  });

  if (adverseDays === 0) {
    return {
      adverseDays: 0,
      classifiedStops: 0,
      outdoorOnAdverseDays: 0,
      violations: [],
      applicable: false,
      reason: "no adverse-weather days in this trip",
      normalized: null,
    };
  }
  if (classifiedStops === 0) {
    return {
      adverseDays,
      classifiedStops: 0,
      outdoorOnAdverseDays: 0,
      violations: [],
      applicable: false,
      reason: "no stop on an adverse day could be classified indoor/outdoor",
      normalized: null,
    };
  }

  return {
    adverseDays,
    classifiedStops,
    outdoorOnAdverseDays,
    violations,
    applicable: true,
    reason: "",
    normalized: 1 - outdoorOnAdverseDays / classifiedStops,
  };
}

// --- budget_accuracy_score -------------------------------------------------------------------------

/**
 * Rough per-stop spend in USD by category. THESE ARE ESTIMATES, NOT DATA.
 *
 * Nothing in the pipeline carries prices: the staged generation path never asks the model for
 * costs, and the trip context has no fares. Pricing a plan therefore requires an assumption, and
 * this table is it — override with BENCH_STOP_PRICES (JSON) rather than treating these as facts.
 * The score they feed is labelled ESTIMATED in the UI for the same reason.
 */
const DEFAULT_STOP_PRICES: Record<string, number> = {
  food: 25,
  entry: 15,
  transit: 5,
  other: 5,
  free: 0,
};

/** Kinds that are typically free to enter, so they aren't charged the generic entry fee. */
const FREE_KINDS = /\b(natural|parks|gardens|beaches|view_points|bridges|urban_environment)\b/i;

export function stopPrices(): Record<string, number> {
  const raw = process.env.BENCH_STOP_PRICES;
  if (!raw) return DEFAULT_STOP_PRICES;
  try {
    return { ...DEFAULT_STOP_PRICES, ...(JSON.parse(raw) as Record<string, number>) };
  } catch {
    return DEFAULT_STOP_PRICES;
  }
}

const MEAL_WORDS = /\b(breakfast|brunch|lunch|dinner|supper|meal|dining|restaurant|food)\b/i;

/**
 * budget_accuracy_score — would this plan fit the traveler's stated budget?
 *
 * Estimates spend per stop from the category table above and compares the trip total against
 * `userAnswers.budget`. Lodging and flights are NOT included: the staged path recommends a stay
 * area rather than a priced property, so charging for it would be inventing a second number on top
 * of an estimate.
 *
 * 1.0 = within budget. Below that, the ratio of budget to estimated spend — so a plan estimated at
 * twice the budget scores 0.5.
 */
export function scoreBudget(itinerary: ParsedItinerary, fixture: BenchFixture): BudgetScore {
  const prices = stopPrices();
  const budget = fixture.reconciled.userAnswers.budget;
  const candidates = fixture.reconciled.rawFetch.candidatePois.pois;

  let estimated = 0;
  let pricedStops = 0;
  const breakdown: Record<string, number> = {};

  for (const day of itinerary.days) {
    for (const entry of dayEntries(day)) {
      let bucket: string;
      if (MEAL_WORDS.test(entry.name) || MEAL_WORDS.test(entry.raw)) {
        bucket = "food";
      } else {
        const match = candidates.find((p) => nameMatches(entry.name, p.name));
        bucket = match?.category && FREE_KINDS.test(match.category) ? "free" : "entry";
      }
      const price = prices[bucket] ?? 0;
      estimated += price;
      breakdown[bucket] = (breakdown[bucket] ?? 0) + price;
      pricedStops++;
    }
  }

  if (budget <= 0 || pricedStops === 0) {
    return {
      estimatedUsd: Math.round(estimated),
      budgetUsd: budget,
      withinBudget: true,
      pricedStops,
      breakdown,
      excludes: ["lodging", "flights"],
      estimateBased: true,
      normalized: null,
    };
  }

  return {
    estimatedUsd: Math.round(estimated),
    budgetUsd: budget,
    withinBudget: estimated <= budget,
    pricedStops,
    breakdown,
    excludes: ["lodging", "flights"],
    estimateBased: true,
    normalized: estimated <= budget ? 1 : Math.max(0, budget / estimated),
  };
}

// --- vibe_match_score ------------------------------------------------------------------------------

/**
 * Maps an OpenTripMap `kinds` string onto the app's own `INTEREST_TAGS` vocabulary, so a stop's
 * tags and the traveler's tags are expressed in the same terms and can actually be intersected.
 */
const KIND_TO_TAG: { pattern: RegExp; tags: string[] }[] = [
  { pattern: /\b(museums|galleries|historic|architecture|religion|cultural|castles|monuments)\b/i, tags: ["Culture & History"] },
  { pattern: /\b(natural|parks|gardens|beaches|geological|water)\b/i, tags: ["Nature & Outdoors"] },
  { pattern: /\b(foods|restaurants|cafes)\b/i, tags: ["Food"] },
  { pattern: /\b(shops|malls|marketplaces)\b/i, tags: ["Shopping"] },
  { pattern: /\b(view_points|bridges)\b/i, tags: ["Photography"] },
  { pattern: /\b(nightlife|bars|clubs)\b/i, tags: ["Nightlife"] },
  { pattern: /\b(amusements|aquariums|zoos|theme_parks)\b/i, tags: ["Family-Friendly"] },
  { pattern: /\b(sport|fitness|spa|baths)\b/i, tags: ["Wellness & Fitness"] },
];

/** Same idea from the words in the entry itself, for stops with no matched POI. */
const WORD_TO_TAG: { pattern: RegExp; tags: string[] }[] = [
  { pattern: /\b(museum|gallery|castle|palace|temple|shrine|church|cathedral|historic|heritage|old town|ruins)\b/i, tags: ["Culture & History"] },
  { pattern: /\b(park|garden|trail|hike|lake|river|forest|mountain|beach|grove|nature)\b/i, tags: ["Nature & Outdoors"] },
  { pattern: /\b(lunch|dinner|breakfast|brunch|food|restaurant|market|tasting|cafe|café|izakaya|kaiseki)\b/i, tags: ["Food"] },
  { pattern: /\b(shop|shopping|boutique|arcade|mall|bazaar)\b/i, tags: ["Shopping"] },
  { pattern: /\b(viewpoint|lookout|vista|sunset|photo|scenic|panorama)\b/i, tags: ["Photography"] },
  { pattern: /\b(bar|club|nightlife|live music|drinks)\b/i, tags: ["Nightlife"] },
  { pattern: /\b(aquarium|zoo|playground|kid|family|hands-on)\b/i, tags: ["Family-Friendly"] },
  { pattern: /\b(spa|onsen|bath|yoga|sauna|massage|swim)\b/i, tags: ["Wellness & Fitness"] },
  { pattern: /\b(relax|leisurely|rest|quiet|stroll|unwind)\b/i, tags: ["Relaxation"] },
];

export function tagsForEntry(entry: ParsedEntry, fixture: BenchFixture): string[] {
  const tags = new Set<string>();
  const candidates = fixture.reconciled.rawFetch.candidatePois.pois;
  const match = candidates.find((p) => nameMatches(entry.name, p.name));

  if (match?.category) {
    for (const { pattern, tags: t } of KIND_TO_TAG) {
      if (pattern.test(match.category)) t.forEach((x) => tags.add(x));
    }
  }
  for (const { pattern, tags: t } of WORD_TO_TAG) {
    if (pattern.test(entry.raw)) t.forEach((x) => tags.add(x));
  }
  return [...tags];
}

/**
 * vibe_match_score — do the chosen stops actually serve this traveler's stated interests?
 *
 * Two readings, both reported:
 *  - `normalized` (the headline) is the share of classifiable stops carrying at least one of the
 *    traveler's tags. It's the actionable number: "two thirds of the plan is on-brief."
 *  - `jaccard` is the set-similarity between the traveler's tags and the union of stop tags. It
 *    answers a different question — breadth of coverage — and punishes a plan for every interest
 *    it never touches, which the per-stop rate does not.
 *
 * `coverage` overlaps with this but isn't the same: it asks whether each STARRED interest appears
 * anywhere, while this asks what fraction of the plan is spent on the traveler's interests at all.
 */
export function scoreVibe(itinerary: ParsedItinerary, fixture: BenchFixture): VibeScore {
  const answers = fixture.reconciled.userAnswers;
  const flags = fixture.reconciled.resolvedFlags;

  // The traveler's tag set: stated interests plus the persona flags that read as tags.
  const tripTags = new Set<string>(answers.priorities);
  if (answers.explorerStyle === "offbeat") tripTags.add("Relaxation");
  if (answers.group === "family_with_kids") tripTags.add("Family-Friendly");
  if (flags.crowdBias.marketsAndLivelyOk) tripTags.add("Nightlife");

  let classifiedStops = 0;
  let matchedStops = 0;
  const stopTagUnion = new Set<string>();
  const offBrief: { dayIndex: number; name: string; tags: string[] }[] = [];

  itinerary.days.forEach((day, dayIndex) => {
    for (const entry of dayEntries(day)) {
      const tags = tagsForEntry(entry, fixture);
      if (tags.length === 0) continue;
      classifiedStops++;
      tags.forEach((t) => stopTagUnion.add(t));
      if (tags.some((t) => tripTags.has(t))) matchedStops++;
      else if (offBrief.length < 8) offBrief.push({ dayIndex, name: entry.name, tags });
    }
  });

  const intersection = [...stopTagUnion].filter((t) => tripTags.has(t)).length;
  const union = new Set([...stopTagUnion, ...tripTags]).size;

  return {
    tripTags: [...tripTags],
    stopTags: [...stopTagUnion],
    classifiedStops,
    matchedStops,
    offBrief,
    jaccard: union > 0 ? intersection / union : null,
    normalized: classifiedStops > 0 ? matchedStops / classifiedStops : null,
  };
}
