import { haversineKm } from "../../travelTime";
import { knownPois } from "../fixtures";
import type { BenchFixture } from "../fixtures";
import { dayEntries, parseClock } from "../parseItinerary";
import type { ParsedItinerary, Slot } from "../parseItinerary";
import { VIOLATION_TYPES } from "../types";
import type {
  BenchLogistics,
  ConstraintViolationScore,
  CoverageScore,
  FeasibilityScore,
  FormatAdherenceScore,
  GeoCoherenceScore,
  GroundingScore,
  ViolationType,
} from "../types";

/**
 * The deterministic domain scorers. Every number here is computed from the itinerary markdown and
 * the fixture's own facts — no LLM is called anywhere in this file, by design.
 *
 * Two conventions run through all of them:
 *
 * 1. **Every scorer reports its own denominator.** `matchedLegs`, `checkedByType`, `namedStops`.
 *    A model whose stop names can't be located scores "0 violations" for the same reason a perfect
 *    model does, and only the denominator tells them apart.
 * 2. **Normalization is explicit and tunable.** Each `normalized` value is 0-1 higher-is-better for
 *    the radar chart, derived through a named constant below rather than a magic number inline.
 */

// --- Tunable scoring constants -----------------------------------------------------------------

/** Inter-stop travel at or above this reads as a badly-clustered day. Sets the geo_coherence floor. */
export const GEO_WORST_MINUTES = 45;

/** Waking-hours budget a day's activity + travel has to fit inside, before it's called infeasible. */
export const WAKING_BUDGET_MIN = 14 * 60;

/** `walk_leg_cap: tight` — a walking leg longer than this breaches the mobility profile. */
export const TIGHT_WALK_CAP_MIN = 20;

/** `rest_breaks` — activity minutes between explicit breaks, above which the rule is breached. */
export const REST_BREAK_INTERVAL_MIN = 3 * 60;

/** The midday band `schedule_icons_at_offpeak` exists to keep landmark visits out of. */
export const PEAK_BAND = { startMin: 11 * 60, endMin: 15 * 60 };

/** Violations per day at or above this score 0 on the radar's constraint-adherence axis. */
export const VIOLATIONS_WORST_PER_DAY = 3;

/** Two names match when this much of the shorter one's significant tokens appear in the other. */
export const NAME_MATCH_THRESHOLD = 0.6;

// --- Name matching -----------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "at", "in", "on", "to", "de", "la", "le", "el",
  "museum", "national", "park", "district", "area", "temple", "shrine", "market",
]);

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(name: string): string[] {
  const tokens = normalizeName(name).split(" ").filter(Boolean);
  const meaningful = tokens.filter((t) => !STOPWORDS.has(t) && t.length > 2);
  // A name made entirely of stopwords ("The Market") still has to match something.
  return meaningful.length > 0 ? meaningful : tokens;
}

/**
 * Fuzzy name match, because a model writes "Fushimi Inari shrine" for a POI listed as
 * "Fushimi Inari Taisha". Token-overlap rather than edit distance: the discriminating part of a
 * place name is a word, not a character run.
 */
export function nameMatches(a: string, b: string): boolean {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t)).length;
  return shared / Math.min(ta.length, tb.length) >= NAME_MATCH_THRESHOLD;
}

export interface LocatedPoi {
  name: string;
  lat: number | null;
  lon: number | null;
}

export function findPoi(entryName: string, pois: LocatedPoi[]): LocatedPoi | null {
  return pois.find((p) => nameMatches(entryName, p.name)) ?? null;
}

// --- Opening-hours parsing (scorer-local) ------------------------------------------------------

const DAY_CODES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * Open ranges for one weekday, in minutes from midnight.
 *
 * Complements `closedDaysFromOpeningHours` in poiDetails.ts rather than replacing it: that one
 * answers "which days is it shut", this one answers "is 14:00 on a Tuesday inside its hours".
 * Returns `null` for syntax it can't read confidently, and the caller counts that as unchecked —
 * never as compliant.
 */
/** Stops that are explicitly nighttime experiences, or simply don't need daylight at all. */
const NIGHT_OK_WORDS =
  /\b(night|nighttime|evening|dusk|sunset|illuminat|lantern|lit|star|stargaz|dinner|supper|drinks|bar|izakaya|pub|club|nightlife|show|theatre|theater|concert|onsen|spa|museum|gallery|aquarium|indoor|arcade|mall|restaurant|cafe|café|lunch|breakfast|brunch)\b/i;

/**
 * Does §10's daylight rule apply to this stop?
 *
 * The rule applies by default and is switched OFF by evidence, rather than switched on by it. A
 * dinner, a bar, an indoor show, a museum, or an explicitly-nighttime stop after sunset is correct
 * planning, not a violation. Everything else is treated as daylight-dependent.
 *
 * The default matters: an earlier version required a positive outdoor-word match, and "Kiyomizu-dera"
 * matches no such word — so a temple scheduled at 19:30 passed silently. For a scorer,
 * under-measuring is the worse failure, so an unrecognised stop is checked rather than skipped.
 */
export function daylightDependent(entry: {
  name: string;
  raw: string;
  why?: string | null;
  category?: string | null;
}): boolean {
  if (entry.category === "food" || entry.category === "transit") return false;
  return !NIGHT_OK_WORDS.test(`${entry.name} ${entry.raw} ${entry.why ?? ""}`);
}

export function hoursForWeekday(
  openingHours: string | null,
  weekday: string
): { ranges: [number, number][] } | "closed" | null {
  if (!openingHours) return null;
  if (openingHours.includes("24/7")) return { ranges: [[0, 24 * 60]] };
  if (/PH|"/i.test(openingHours)) return null;

  const target = DAY_CODES.findIndex((d) => d.toLowerCase() === weekday.slice(0, 2).toLowerCase());
  if (target === -1) return null;

  let matched = false;
  const ranges: [number, number][] = [];

  for (const clause of openingHours.split(";")) {
    const text = clause.trim();
    if (!text) continue;

    const dayPart = text.match(
      /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s*(.*)$/
    );
    if (!dayPart) continue;

    const days = new Set<number>();
    for (const group of dayPart[1].split(",")) {
      const bounds = group.trim().split(/\s*-\s*/);
      const start = DAY_CODES.indexOf(bounds[0]);
      if (start === -1) continue;
      if (bounds.length === 1) {
        days.add(start);
        continue;
      }
      const end = DAY_CODES.indexOf(bounds[1]);
      if (end === -1) continue;
      for (let i = start; ; i = (i + 1) % 7) {
        days.add(i);
        if (i === end) break;
      }
    }
    if (!days.has(target)) continue;
    matched = true;

    const rest = dayPart[2].trim();
    if (/^(off|closed)$/i.test(rest)) return "closed";

    for (const span of rest.split(",")) {
      const m = span.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      if (!m) continue;
      const from = parseClock(m[1]);
      let to = parseClock(m[2]);
      if (from === null || to === null) continue;
      if (to <= from) to += 24 * 60;
      ranges.push([from, to]);
    }
  }

  if (!matched) return "closed";
  return ranges.length > 0 ? { ranges } : null;
}

// --- geo_coherence -----------------------------------------------------------------------------

/** Same door-to-door speeds the app's own travel-time estimator uses, so the two are comparable. */
const SPEED_KMH: Record<string, number> = { walk: 4.5, transit: 18, drive: 30 };
const ROUTE_CIRCUITY_FACTOR = 1.3;

/**
 * geo_coherence — mean inter-POI travel within each day. Lower is better.
 *
 * Measures only consecutive stop pairs where BOTH names resolve to coordinates in the fixture's
 * candidate/anchor set, since a stop the model invented has no location to measure. `matchedLegs`
 * vs `totalLegs` is therefore part of the reading, not a footnote.
 */
export function scoreGeoCoherence(
  itinerary: ParsedItinerary,
  fixture: BenchFixture
): GeoCoherenceScore {
  const pois = knownPois(fixture);
  const modes = fixture.reconciled.transportModes;
  const speed = SPEED_KMH[modes.includes("transit") ? "transit" : modes.includes("drive") ? "drive" : "walk"];

  const perDayMeanMinutes: (number | null)[] = [];
  let matchedLegs = 0;
  let totalLegs = 0;
  const allKm: number[] = [];

  for (const day of itinerary.days) {
    const located = dayEntries(day)
      .map((e) => findPoi(e.name, pois))
      .filter((p): p is LocatedPoi => p !== null && p.lat !== null && p.lon !== null);

    const dayKm: number[] = [];
    const entries = dayEntries(day);
    totalLegs += Math.max(entries.length - 1, 0);

    for (let i = 0; i + 1 < located.length; i++) {
      const a = located[i];
      const b = located[i + 1];
      const km = haversineKm(
        { lat: a.lat as number, lon: a.lon as number },
        { lat: b.lat as number, lon: b.lon as number }
      ) * ROUTE_CIRCUITY_FACTOR;
      dayKm.push(km);
      allKm.push(km);
      matchedLegs++;
    }

    perDayMeanMinutes.push(
      dayKm.length > 0
        ? Math.round((dayKm.reduce((s, km) => s + km, 0) / dayKm.length / speed) * 60)
        : null
    );
  }

  if (allKm.length === 0) {
    return {
      perDayMeanMinutes,
      tripMeanMinutes: null,
      tripMeanKm: null,
      matchedLegs,
      totalLegs,
      normalized: null,
    };
  }

  const meanKm = allKm.reduce((s, km) => s + km, 0) / allKm.length;
  const meanMinutes = Math.round((meanKm / speed) * 60);

  return {
    perDayMeanMinutes,
    tripMeanMinutes: meanMinutes,
    tripMeanKm: Math.round(meanKm * 10) / 10,
    matchedLegs,
    totalLegs,
    normalized: Math.max(0, 1 - meanMinutes / GEO_WORST_MINUTES),
  };
}

// --- constraint_violations ---------------------------------------------------------------------

const BREAK_WORDS = /\b(break|rest|coffee|tea|sit|lunch|dinner|breakfast|picnic)\b/i;

/**
 * constraint_violations — breaches of the rules the skill and the resolved flags impose, counted
 * by type.
 *
 * Each type states what it can and can't see:
 * - `opening_hours` / `closed_day`: only for stops that resolve to a POI whose hours the context
 *   actually carried. Unknown hours count as unchecked.
 * - `daylight`: entries starting before sunrise or ending after sunset, EXCLUDING the Evening slot
 *   — the skill explicitly permits after-dark evening POIs (§5), so counting those would penalise
 *   correct behaviour.
 * - `pace`: only over-run counts. The skill's wording is a cap ("never plan more stops than the
 *   target"), so a short day is under-delivery, not a breach; it's reported separately as a stat.
 * - `mobility`: walking legs over the tight cap, plus days that run past the rest-break interval
 *   with no break entry (only when `restBreaks` is set).
 * - `crowd_bias`: a heuristic proxy — a known landmark scheduled inside the midday peak band while
 *   `scheduleIconsAtOffpeak` is set.
 */
export function scoreConstraints(
  itinerary: ParsedItinerary,
  fixture: BenchFixture
): ConstraintViolationScore {
  const flags = fixture.reconciled.resolvedFlags;
  const anchors = fixture.poiDetails.pois;
  const pois = knownPois(fixture);
  const weatherDays = fixture.reconciled.rawFetch.weather.days;
  const tripDays = fixture.reconciled.rawFetch.dateContext.days;

  const byType = Object.fromEntries(VIOLATION_TYPES.map((t) => [t, 0])) as Record<ViolationType, number>;
  const checkedByType = Object.fromEntries(VIOLATION_TYPES.map((t) => [t, 0])) as Record<ViolationType, number>;
  const details: ConstraintViolationScore["details"] = [];

  const add = (type: ViolationType, dayIndex: number, detail: string) => {
    byType[type]++;
    details.push({ type, dayIndex, detail });
  };

  itinerary.days.forEach((day, dayIndex) => {
    const entries = dayEntries(day);
    const tripDay = tripDays[dayIndex];
    const weekday = day.dayOfWeek ?? tripDay?.dayOfWeek ?? null;
    const forecast = weatherDays[dayIndex];

    // --- hours + closed days
    for (const entry of entries) {
      const anchor = anchors.find((p) => nameMatches(entry.name, p.name));
      if (!anchor) continue;

      if (weekday && anchor.closedDays && anchor.closedDays.length > 0) {
        checkedByType.closed_day++;
        if (anchor.closedDays.some((d) => d.toLowerCase() === weekday.slice(0, 2).toLowerCase())) {
          add("closed_day", dayIndex, `${anchor.name} is closed on ${weekday}`);
        }
      }

      if (weekday && entry.window) {
        const hours = hoursForWeekday(anchor.openingHours, weekday);
        if (hours === "closed") {
          checkedByType.opening_hours++;
          add("opening_hours", dayIndex, `${anchor.name} is shut all day on ${weekday}`);
        } else if (hours) {
          checkedByType.opening_hours++;
          const inside = hours.ranges.some(
            ([from, to]) => (entry.window as { startMin: number }).startMin >= from &&
              (entry.window as { endMin: number }).endMin <= to
          );
          if (!inside) {
            add(
              "opening_hours",
              dayIndex,
              `${anchor.name} scheduled outside "${anchor.openingHours}"`
            );
          }
        }
      }
    }

    // --- daylight (skill §10)
    //
    // The exemption used to be `slot === "Evening"`, which stopped working the moment slots were
    // derived from each stop's start time: anything after 17:00 is Evening by definition, so an
    // after-dark stop could never breach the rule and the check silently measured nothing.
    //
    // §10's actual exemption is about the KIND of stop, not the hour — "don't schedule an outdoor,
    // scenic, or view-dependent stop after dark unless the point of the stop is a nighttime
    // experience", and "evening stops that don't depend on daylight (dinner, a bar, an indoor
    // show) are unaffected". `daylightDependent` below is that test.
    if (forecast?.sunrise && forecast?.sunset) {
      const sunrise = parseClock(forecast.sunrise.split("T")[1]?.slice(0, 5) ?? "");
      const sunset = parseClock(forecast.sunset.split("T")[1]?.slice(0, 5) ?? "");
      if (sunrise !== null && sunset !== null) {
        for (const entry of entries) {
          if (!daylightDependent(entry) || !entry.window) continue;
          checkedByType.daylight++;
          if (entry.window.startMin < sunrise || entry.window.endMin > sunset) {
            add(
              "daylight",
              dayIndex,
              `${entry.name} runs outside daylight (${forecast.sunrise.split("T")[1]?.slice(0, 5)}-${forecast.sunset.split("T")[1]?.slice(0, 5)})`
            );
          }
        }
      }
    }

    // --- pace (a cap, so only over-run is a breach)
    const majorStops = entries.filter((e) => !e.areaLevel).length;
    checkedByType.pace++;
    if (majorStops > flags.paceSpotsPerDay) {
      add(
        "pace",
        dayIndex,
        `${majorStops} stops against a ${flags.paceSpotsPerDay}/day target`
      );
    }

    // --- mobility
    if (flags.mobilityProfile.walkLegCap === "tight") {
      for (const entry of entries) {
        if (entry.transport?.mode !== "walk" || entry.transport.minutes === null) continue;
        checkedByType.mobility++;
        if (entry.transport.minutes > TIGHT_WALK_CAP_MIN) {
          add(
            "mobility",
            dayIndex,
            `${entry.transport.minutes} min walk exceeds the ${TIGHT_WALK_CAP_MIN} min tight cap`
          );
        }
      }
    }
    if (flags.mobilityProfile.restBreaks && entries.length > 0) {
      checkedByType.mobility++;
      let sinceBreak = 0;
      let missed = false;
      for (const entry of entries) {
        if (BREAK_WORDS.test(entry.raw)) {
          sinceBreak = 0;
          continue;
        }
        sinceBreak += entry.durationMin ?? 60;
        if (sinceBreak > REST_BREAK_INTERVAL_MIN) missed = true;
      }
      if (missed) {
        add("mobility", dayIndex, `over ${REST_BREAK_INTERVAL_MIN / 60}h of activity with no rest entry`);
      }
    }

    // --- crowd bias
    if (flags.crowdBias.scheduleIconsAtOffpeak) {
      for (const entry of entries) {
        if (!entry.window || entry.areaLevel) continue;
        if (!findPoi(entry.name, pois)) continue;
        checkedByType.crowd_bias++;
        const midday =
          entry.window.startMin >= PEAK_BAND.startMin && entry.window.startMin < PEAK_BAND.endMin;
        if (midday) {
          add("crowd_bias", dayIndex, `${entry.name} scheduled inside the midday peak band`);
        }
      }
    }
  });

  const total = VIOLATION_TYPES.reduce((sum, t) => sum + byType[t], 0);
  const dayCount = itinerary.days.length;
  const normalized =
    dayCount === 0
      ? null
      : Math.max(0, 1 - total / dayCount / VIOLATIONS_WORST_PER_DAY);

  return { total, byType, checkedByType, details, normalized };
}

// --- feasibility -------------------------------------------------------------------------------

/**
 * feasibility — can a human actually do this day?
 *
 * Two independent failures: time windows that overlap (the traveler is in two places at once), and
 * days whose activity + stated travel time exceeds a realistic waking budget.
 */
export function scoreFeasibility(itinerary: ParsedItinerary): FeasibilityScore {
  let overlaps = 0;
  let overBudgetDays = 0;
  const perDayLoadMinutes: (number | null)[] = [];

  for (const day of itinerary.days) {
    const entries = dayEntries(day);
    const windows = entries
      .map((e) => e.window)
      .filter((w): w is { startMin: number; endMin: number } => w !== null)
      .sort((a, b) => a.startMin - b.startMin);

    for (let i = 0; i + 1 < windows.length; i++) {
      if (windows[i + 1].startMin < windows[i].endMin) overlaps++;
    }

    const activity = entries.reduce((sum, e) => {
      if (e.durationMin !== null) return sum + e.durationMin;
      if (e.window) return sum + (e.window.endMin - e.window.startMin);
      return sum;
    }, 0);
    const travel = entries.reduce((sum, e) => sum + (e.transport?.minutes ?? 0), 0);
    const load = activity + travel;

    perDayLoadMinutes.push(entries.length > 0 ? load : null);
    if (load > WAKING_BUDGET_MIN) overBudgetDays++;
  }

  const dayCount = itinerary.days.length;
  const normalized =
    dayCount === 0 ? null : Math.max(0, 1 - (overlaps + overBudgetDays) / dayCount);

  return { overlaps, overBudgetDays, perDayLoadMinutes, wakingBudgetMin: WAKING_BUDGET_MIN, normalized };
}

// --- coverage ----------------------------------------------------------------------------------

/**
 * coverage — did the plan reflect what was asked for?
 *
 * Two halves: the starred priorities (matched lexically against day themes, entry text and notes,
 * with a small synonym map) and the traveler's pinned anchors (name-matched). Priority matching is
 * lexical evidence, not semantics — a day that delivers "history" without ever using the word
 * scores as a miss here, which is why the semantic `relevance` scorer sits alongside it.
 */
/**
 * Keyed by the app's own `INTEREST_TAGS` (see components/InterestPicker.tsx), lowercased — the
 * benchmark form emits exactly those strings, so the scorer has to speak that vocabulary rather
 * than an invented one. Each entry lists the words a plan would plausibly use to *deliver* the
 * interest without naming it. Extra lowercase keys are kept as aliases so a hand-written fixture
 * or a BENCH override using shorthand still matches.
 */
const PRIORITY_SYNONYMS: Record<string, string[]> = {
  "food": ["restaurant", "eat", "dining", "cuisine", "meal", "market", "street food", "lunch", "dinner", "izakaya", "tasting"],
  "wellness & fitness": ["spa", "onsen", "bath", "yoga", "gym", "hot spring", "sauna", "massage", "swim"],
  "culture & history": ["historic", "heritage", "ancient", "castle", "ruins", "old town", "museum", "temple", "shrine", "gallery", "palace"],
  "nightlife": ["bar", "club", "night", "drinks", "live music", "izakaya", "pub"],
  "nature & outdoors": ["park", "garden", "trail", "lake", "forest", "outdoor", "scenic", "hike", "mountain", "river", "grove"],
  "shopping": ["shop", "boutique", "store", "market", "arcade", "bazaar"],
  "family-friendly": ["kid", "child", "family", "playground", "aquarium", "zoo", "hands-on"],
  "relaxation": ["relax", "leisurely", "slow", "rest", "unwind", "quiet", "stroll", "cafe", "café"],
  "photography": ["photo", "viewpoint", "vista", "golden hour", "scenic", "lookout", "light"],
  // Shorthand aliases.
  "history": ["historic", "heritage", "ancient", "castle", "ruins", "old town", "museum", "temple", "shrine"],
  "nature": ["park", "garden", "trail", "lake", "forest", "outdoor", "scenic", "hike"],
  "hiking": ["hike", "trail", "walk", "trek", "summit", "lookout"],
  "art": ["gallery", "museum", "mural", "exhibition", "artist"],
  "architecture": ["building", "cathedral", "facade", "design", "tower"],
  "markets": ["market", "bazaar", "stalls", "vendors"],
  "parks": ["park", "garden", "playground", "green"],
  "wine": ["winery", "vineyard", "cellar", "tasting"],
};

export function scoreCoverage(itinerary: ParsedItinerary, fixture: BenchFixture): CoverageScore {
  const starred = fixture.reconciled.resolvedFlags.prioritiesRanked.primary;
  const anchors = fixture.poiDetails.pois;

  const haystack = itinerary.days
    .flatMap((day) => [
      day.headingRaw,
      day.stayNear ?? "",
      day.note ?? "",
      ...dayEntries(day).map((e) => e.raw),
    ])
    .join(" ")
    .toLowerCase();

  const missingStarred = starred.filter((tag) => {
    const terms = [tag.toLowerCase(), ...(PRIORITY_SYNONYMS[tag.toLowerCase()] ?? [])];
    return !terms.some((t) => haystack.includes(t));
  });

  const entryNames = itinerary.days.flatMap((d) => dayEntries(d).map((e) => e.name));
  const missingAnchors = anchors
    .filter((a) => !entryNames.some((n) => nameMatches(n, a.name)))
    .map((a) => a.name);

  const starredCovered = starred.length - missingStarred.length;
  const anchorsIncluded = anchors.length - missingAnchors.length;

  // With no starred priorities AND no anchors there is nothing to cover — null, not a free 1.0.
  if (starred.length === 0 && anchors.length === 0) {
    return {
      starredCovered: 0,
      starredTotal: 0,
      anchorsIncluded: 0,
      anchorsTotal: 0,
      missingStarred: [],
      missingAnchors: [],
      normalized: null,
    };
  }

  const parts: number[] = [];
  if (starred.length > 0) parts.push(starredCovered / starred.length);
  if (anchors.length > 0) parts.push(anchorsIncluded / anchors.length);

  return {
    starredCovered,
    starredTotal: starred.length,
    anchorsIncluded,
    anchorsTotal: anchors.length,
    missingStarred,
    missingAnchors,
    normalized: parts.reduce((s, p) => s + p, 0) / parts.length,
  };
}

// --- grounding ---------------------------------------------------------------------------------

/**
 * grounding — is the output tied to what the context actually said?
 *
 * This app needs TWO numbers, and conflating them would misread the model badly. The skill (§1b)
 * explicitly tells the model to choose stops itself from the traveler profile when anchors are
 * sparse, so a named stop outside the candidate list is *expected behaviour*, not a hallucination:
 * that's `unlistedRate`, reported as a descriptive statistic.
 *
 * The real hallucination signal is `contextContradictions` — the output asserting a specific fact
 * the context never carried, which the skill's "Missing Facts" rule forbids outright: opening hours
 * for a POI whose hours the context marked unknown, or a travel time for a pair with no leg in the
 * bundle. Only that feeds the radar axis.
 */
const HOURS_CLAIM = /\b(?:open|opens|closes|closing|hours)\b[^.]{0,40}\d{1,2}(?::\d{2})?\s*(?:am|pm|:00)/i;

export function scoreGrounding(itinerary: ParsedItinerary, fixture: BenchFixture): GroundingScore {
  const pois = knownPois(fixture);
  const anchors = fixture.poiDetails.pois;
  const legs = fixture.poiDetails.travelLegs;

  const entries = itinerary.days.flatMap(dayEntries);
  const named = entries.filter((e) => !e.areaLevel);

  const unlisted = named.filter((e) => !findPoi(e.name, pois));

  const examples: string[] = [];
  let contradictions = 0;

  for (const entry of entries) {
    // An hours claim about a POI the context said it didn't know the hours for.
    const anchor = anchors.find((p) => nameMatches(entry.name, p.name));
    if (anchor && anchor.openingHours === null && HOURS_CLAIM.test(entry.raw)) {
      contradictions++;
      if (examples.length < 5) examples.push(`invented hours: ${entry.raw.slice(0, 90)}`);
      continue;
    }
    // A specific travel time for a pair the context carried no leg for. Only counted when both
    // ends are anchors — the leg list only ever covers anchors, so anything else is unknowable.
    if (entry.transport?.minutes !== null && entry.transport) {
      const from = anchors.find((p) => nameMatches(entry.name, p.name));
      if (from) {
        const hasLeg = legs.some((l) => nameMatches(l.from, from.name) || nameMatches(l.to, from.name));
        if (!hasLeg && legs.length > 0) {
          contradictions++;
          if (examples.length < 5) examples.push(`travel time not in context: ${entry.transport.raw.slice(0, 90)}`);
        }
      }
    }
  }

  const namedStops = named.length;
  return {
    namedStops,
    unlistedStops: unlisted.length,
    unlistedRate: namedStops > 0 ? unlisted.length / namedStops : null,
    contextContradictions: contradictions,
    contradictionRate: entries.length > 0 ? contradictions / entries.length : null,
    examples,
    normalized: entries.length > 0 ? Math.max(0, 1 - contradictions / entries.length) : null,
  };
}

// --- slot usability ----------------------------------------------------------------------------

/** Nominal span of each slot, used only to decide whether a booked flight consumes it. */
const SLOT_BOUNDS: Record<Slot, { startMin: number; endMin: number }> = {
  Morning: { startMin: 6 * 60, endMin: 12 * 60 },
  Afternoon: { startMin: 12 * 60, endMin: 17 * 60 },
  Evening: { startMin: 17 * 60, endMin: 23 * 60 },
};

/** Hours a traveler loses to immigration, bags and the transfer in — skill §4c-bis. */
export const TRANSFER_BUFFER_MIN = 90;

/**
 * Is this slot actually available to plan into?
 *
 * False only when the traveler's own booked logistics consume it: an arrival part-way through day
 * one, or a departure part-way through the last day. Everything else is usable, so an empty slot
 * anywhere else is a genuine omission.
 */
export function usableSlot(
  slot: Slot,
  dayIndex: number,
  dayCount: number,
  fixture: BenchFixture
): boolean {
  const logistics = (fixture.reconciled.userAnswers as { logistics?: BenchLogistics | null })
    .logistics;
  if (!logistics) return true;
  const bounds = SLOT_BOUNDS[slot];

  if (dayIndex === 0 && logistics.arrivalTime) {
    const landed = parseClock(logistics.arrivalTime);
    if (landed !== null && bounds.endMin <= landed + TRANSFER_BUFFER_MIN) return false;
  }
  if (dayIndex === dayCount - 1 && logistics.departureTime) {
    const leaves = parseClock(logistics.departureTime);
    if (leaves !== null && bounds.startMin >= leaves - TRANSFER_BUFFER_MIN) return false;
  }
  return true;
}

// --- format_adherence --------------------------------------------------------------------------

/**
 * format_adherence — does the output match the fixed schema in skill §11?
 *
 * Pass/fail plus the fraction of individual checks passed, so a near-miss (one stop missing its
 * cost) reads differently from a model that ignored the format wholesale.
 *
 * Rewritten from the §6 checks. Those required slot blocks and a `Stay near:` line that §11 does
 * not emit, so every run failed them regardless of the model. The per-stop field checks below are
 * §11's own list — time, category, duration, cost, lat/lng, why, note — which is also what makes
 * the budget scorer able to read a real total for the first time.
 */
export function scoreFormat(
  itinerary: ParsedItinerary,
  fixture: BenchFixture
): FormatAdherenceScore {
  const expectedDays = fixture.reconciled.rawFetch.dateContext.tripDays;
  const checks: FormatAdherenceScore["checks"] = [];
  const missingFields: string[] = [];

  const check = (name: string, passed: boolean, detail?: string) => {
    checks.push({ name, passed, detail });
    if (!passed) missingFields.push(name);
  };

  check("no code fence", !itinerary.hadCodeFence);
  check(
    "one heading per trip day",
    itinerary.days.length === expectedDays,
    `${itinerary.days.length} headings for a ${expectedDays}-day trip`
  );
  check(
    "day headings carry a date",
    itinerary.days.length > 0 && itinerary.days.every((d) => d.date !== null)
  );
  // §11 forbids a preamble outright ("no preamble, no commentary, no code fences").
  check("no preamble", itinerary.preamble.trim().length === 0);
  check(
    "every day has a narrative line",
    itinerary.days.length > 0 && itinerary.days.every((d) => d.theme !== null)
  );
  check(
    "every day has a Weather line",
    itinerary.days.length > 0 && itinerary.days.every((d) => d.weather !== null)
  );
  // §11: "Omit the Lodging line on the last day only." Requiring it there would fail a model for
  // following the format, and requiring it nowhere would miss a plan with no base at all.
  const lodgingDays = itinerary.days.slice(0, -1);
  check(
    "Lodging line on every day but the last",
    lodgingDays.length === 0 || lodgingDays.every((d) => d.lodging !== null),
    `${lodgingDays.filter((d) => d.lodging === null).length} of ${lodgingDays.length} missing`
  );
  check(
    "no Lodging line on the last day",
    itinerary.days.length === 0 || itinerary.days[itinerary.days.length - 1].lodging === null
  );

  // §11's per-stop field list, checked one field at a time: "1 of 14 missing a cost" is actionable
  // in a way that a single lumped "malformed stops" count is not.
  const entries = itinerary.days.flatMap(dayEntries);
  const fieldCheck = (name: string, ok: (e: (typeof entries)[number]) => boolean) => {
    const missing = entries.filter((e) => !ok(e)).length;
    check(name, entries.length > 0 && missing === 0, `${missing} of ${entries.length} missing`);
  };
  fieldCheck("every stop has a start time", (e) => e.window !== null);
  fieldCheck("every stop has a duration", (e) => e.durationMin !== null);
  fieldCheck("every stop has a category", (e) => e.category !== null);
  fieldCheck("every stop has a cost", (e) => e.costUsd !== null);
  fieldCheck("every stop has coordinates", (e) => e.lat !== null && e.lng !== null);
  fieldCheck("every stop has a why line", (e) => Boolean(e.why));
  fieldCheck("every stop has a note line", (e) => Boolean(e.note));

  // §3c: the leg from the previous stop rides in that stop's note, so the first stop of each day
  // is exempt. Read from the note rather than from a `→` line, which §11 doesn't have.
  const missingLeg = itinerary.days.reduce((sum, day) => {
    const list = dayEntries(day);
    return sum + list.slice(1).filter((e) => e.transport === null).length;
  }, 0);
  check("note carries the travel leg from the previous stop", missingLeg === 0, `${missingLeg} gaps`);

  const passed = checks.filter((c) => c.passed).length;
  return {
    pass: passed === checks.length,
    normalized: checks.length > 0 ? passed / checks.length : 0,
    checks,
    missingFields,
  };
}
