import { normalizeStopName } from "../../placeConflicts";
import { allEntries, dayEntries } from "../parseItinerary";
import { ARRIVAL_BUFFER_MIN, DEPARTURE_BUFFER_MIN } from "./domain";
import type { TripLogistics } from "../../types";
import type { ParsedEntry, ParsedItinerary } from "../parseItinerary";
import type { CommitmentScore, DuplicateScore, MustIncludeScore } from "../types";

/**
 * The three requirement rules the benchmark could not see: §14e duplicates, §0 rank 1 commitments
 * and §0 rank 4 must-dos/exclusions.
 *
 * **Deliberately a second implementation of `guardrails.ts`'s `checkDuplicates`, `checkCommitments`
 * and `checkRequired`, in the spirit of that file's own header.** The duplication is not an
 * oversight waiting to be factored out: the guardrail runs on the live `Itinerary` — typed stops
 * with `time: "09:30"`, `durationLabel: "2h"` and non-null `lat`/`lng` — in the browser, where it
 * must stay synchronous and client-importable. These run on the benchmark's `ParsedItinerary`,
 * where every field is a best-effort read off model markdown and any of them may be null. Two
 * shapes, two runtimes; sharing code would mean one of them adapting to the other's nullability at
 * every field, and the adapter would be larger than either implementation.
 *
 * What may not diverge is the *semantics*, so each function below names the guardrail it mirrors
 * and flags where the parsed shape forced a different read. Three of those semantics were each
 * fixed after a real failure and are reproduced exactly:
 *
 * - **Duplicates match on proximity only for stops that are neither `food` nor `transit`.** §3b
 *   has an area-level food stop carry the neighbourhood's own lat/lng, so two meals near one
 *   market are supposed to land on the same point; a transit leg out to a station and the leg back
 *   is the same place twice on purpose. Name matching still applies to every category.
 * - **Exclusions match on word boundaries, must-includes on substrings.** `avoid: ["bar"]` firing
 *   on "Barcelona" is a scorer that cries wolf; `mustInclude: ["Louvre"]` has to find "Louvre
 *   Museum".
 * - **The departure check compares each stop's END time, not its start.** A stop that begins
 *   before the buffer and runs through it is the miss worth catching.
 *
 * And one place where the parsed shape forces this scorer to be **more conservative than the
 * guardrail**, rather than merely different: `ParsedEntry.category` can be null where
 * `Stop.category` cannot, so an unreadable category is counted as co-location-expected and its
 * proximity check is skipped. A benchmark is least trustworthy exactly where its inputs are lossy,
 * which is where it should lean towards a miss over a false alarm — the same direction
 * `checkPartyBudget`, `stayBooked` and the original food/transit narrowing each went. The cost of
 * getting it the other way round is not a stray warning here but a biased instrument: an arm with
 * weaker format adherence would be penalised on the duplicates axis for something that is not a
 * duplicate, and the A/B would read that as a rule regression.
 *
 * Every `normalized` here is `null`, never 1.0, when the fixture stated nothing to check — see the
 * `DuplicateScore` docblock in `../types`.
 */

/** Same 0.0015° (~150m) box `guardrails.ts` uses, and for the same reason: this comparison does not
 *  need a haversine, and two files disagreeing about what "the same place" means is the drift the
 *  duplication above is on notice for. */
const DUPLICATE_DEGREES = 0.0015;

/**
 * §11's `food`/`transit` categories, where sharing a coordinate is by design — **plus the
 * unreadable one.**
 *
 * `guardrails.ts` reads the same two off `StopCategory`, which is never null. `ParsedEntry.category`
 * is null whenever §11's category field is missing or malformed, and treating that as "not food,
 * not transit" would let two area-level food stops carrying one neighbourhood's coordinates score
 * as a repeat — precisely the false positive the exemption was added to stop, reintroduced through
 * the one input the scorer cannot trust. So proximity matching applies only where the category is
 * positively KNOWN to be neither. Name matching is untouched and still catches these.
 */
/** Rest/break entries and journey legs repeat by nature; like meals, they are not a place visited
 *  twice. The model tags "Drive back to Reykjavik" as `other` as often as `transit`, so the leg is
 *  read off the name. */
const REST_ENTRY = /\b(rest|break)\b|^(drive|return|head|transfer|travel|walk|ride|train|bus|ferry|taxi)\b/i;

/** 0,0 is the unresolved sentinel (guardrails.ts `located`), not a shared point. */
const unresolved = (e: ParsedEntry) => e.lat === 0 && e.lng === 0;

function coLocationExpected(entry: ParsedEntry): boolean {
  return entry.category === null || entry.category === "food" || entry.category === "transit";
}

/**
 * §14e — the same place scheduled twice across the trip. Mirrors `checkDuplicates`.
 *
 * Trip-wide rather than per-day, because reading a plan day by day is exactly how a repeat
 * survives. Matches on the normalized name OR on proximity, never requiring both.
 *
 * **Divergences forced by the parsed shape**, all three towards a miss rather than a false alarm:
 * lodging is exempt in the guardrail by living on its own field, and it is exempt here for free —
 * `dayEntries` never returns the lodging line. `lat`/`lng` are nullable here where `Stop`
 * guarantees numbers, so the proximity branch needs both points present; an unlocated stop falls
 * back to name matching alone rather than being compared against 0,0. And an unreadable category
 * is treated as co-location-expected — see `coLocationExpected` below.
 */
export function scoreDuplicates(itinerary: ParsedItinerary): DuplicateScore {
  const seen: { key: string; entry: ParsedEntry }[] = [];
  const examples: DuplicateScore["examples"] = [];
  let checkedStops = 0;
  let repeats = 0;
  let hardRepeats = 0;

  itinerary.days.forEach((day, dayIndex) => {
    for (const entry of dayEntries(day)) {
      const key = normalizeStopName(entry.name);
      if (!key) continue;
      checkedStops++;

      const near = (prior: ParsedEntry) =>
        !coLocationExpected(entry) &&
        !coLocationExpected(prior) &&
        entry.lat !== null &&
        entry.lng !== null &&
        prior.lat !== null &&
        prior.lng !== null &&
        !unresolved(entry) &&
        !unresolved(prior) &&
        Math.abs(prior.lat - entry.lat) < DUPLICATE_DEGREES &&
        Math.abs(prior.lng - entry.lng) < DUPLICATE_DEGREES;

      const prior = seen.find((s) => s.key === key || near(s.entry));
      if (prior) {
        repeats++;
        const byName = prior.key === key;
        if (byName && !coLocationExpected(entry) && !REST_ENTRY.test(entry.name)) hardRepeats++;
        examples.push({
          dayIndex,
          name: entry.name,
          priorName: prior.entry.name,
          by: prior.key === key ? "name" : "proximity",
        });
      } else {
        seen.push({ key, entry });
      }
    }
  });

  return {
    checkedStops,
    repeats,
    hardRepeats,
    examples,
    normalized: checkedStops > 0 ? Math.max(0, 1 - repeats / checkedStops) : null,
  };
}

/**
 * §0 rank 4 — what the traveler named outright. Mirrors `checkRequired`.
 *
 * A must-include is not an interest tag: a plan missing it has failed however good the rest is.
 * Both lists are scored on one denominator, because both are the same kind of failure — the
 * fraction of stated requirements the plan honoured.
 *
 * The asymmetric matching is `checkRequired`'s and is the point: must-includes are substrings
 * ("Louvre" must find "Louvre Museum"), exclusions are whole words (`avoid: ["bar"]` must not
 * fire on "Barcelona"). `normalizeStopName` leaves lowercase alphanumerics separated by single
 * spaces, so padding both sides with a space is the whole of the boundary test — and it still
 * matches a multi-word exclusion as a contiguous run of whole words.
 *
 * **No divergence from the guardrail.** Its `names` list is the same flatten this does; the
 * parsed entry names are simply less trustworthy, which changes nothing about the rule.
 */
export function scoreMustInclude(
  itinerary: ParsedItinerary,
  mustInclude: string[],
  avoid: string[]
): MustIncludeScore {
  const named = allEntries(itinerary).map((e) => ({ name: e.name, key: normalizeStopName(e.name) }));

  const missing: string[] = [];
  let includedCount = 0;
  let checked = 0;

  for (const want of mustInclude) {
    const key = normalizeStopName(want);
    if (!key) continue;
    checked++;
    if (named.some((n) => n.key.includes(key))) includedCount++;
    else missing.push(want);
  }

  const violated: MustIncludeScore["violated"] = [];
  let respectedCount = 0;

  for (const unwanted of avoid) {
    const key = normalizeStopName(unwanted);
    if (!key) continue;
    checked++;
    const hit = named.find((n) => ` ${n.key} `.includes(` ${key} `));
    if (hit) violated.push({ term: unwanted, stopName: hit.name });
    else respectedCount++;
  }

  return {
    includedCount,
    missing,
    respectedCount,
    violated,
    checked,
    normalized: checked > 0 ? (includedCount + respectedCount) / checked : null,
  };
}

/**
 * §0 rank 1 — what the traveler already committed to, which no plan may cross. Mirrors
 * `checkCommitments`.
 *
 * Three checks, each skipped when its field is absent: "not stated" is a real state and must not
 * read as a boundary of midnight. A logistics object with every field null therefore scores `null`
 * — unmeasurable — exactly as a fixture with no logistics at all does.
 *
 * `checked` is the number of individual stop (or lodging) checks the stated fields made possible,
 * not the number of fields. A last day with six stops in it is six chances to miss the flight, and
 * a plan that misses one of them should not score the same as one that misses all six.
 *
 * **Divergence forced by the parsed shape:** the guardrail computes a stop's end as
 * `parseClock(time) + parseDuration(durationLabel)`; here §11's written window already carries an
 * explicit `endMin`, so that is read directly. It is the same quantity from a more direct source —
 * and an entry with no window at all is skipped rather than assumed, the way the guardrail skips a
 * stop whose `time` will not parse. The prepaid-stay check reads `ParsedLodging.costUsd`, where
 * `null` means the model wrote no price: that is not a breach, it is nothing to score, so it is
 * not counted in `checked` either.
 */
export function scoreCommitments(
  itinerary: ParsedItinerary,
  logistics: TripLogistics | null | undefined
): CommitmentScore {
  const breaches: CommitmentScore["breaches"] = [];
  let checked = 0;
  let passed = 0;

  if (!logistics) return { checked, passed, breaches, normalized: null };

  const lastIndex = itinerary.days.length - 1;

  const landed = parseHhMm(logistics.arrivalTime);
  if (landed !== null && itinerary.days[0]) {
    const clears = landed + ARRIVAL_BUFFER_MIN;
    for (const entry of dayEntries(itinerary.days[0])) {
      if (!entry.window) continue;
      checked++;
      if (entry.window.startMin < clears) {
        breaches.push({ dayIndex: 0, name: entry.name, reason: "arrival" });
      } else {
        passed++;
      }
    }
  }

  const leaves = parseHhMm(logistics.departureTime);
  if (leaves !== null && lastIndex >= 0 && itinerary.days[lastIndex]) {
    // Travel time to the departure point is not known here, so this is the processing buffer
    // alone — `scoreFeasibility` is what catches the transfer half, the same split `guardrails.ts`
    // makes between this check and §12a's.
    const mustEndBy = leaves - DEPARTURE_BUFFER_MIN;
    for (const entry of dayEntries(itinerary.days[lastIndex])) {
      if (!entry.window) continue;
      checked++;
      if (entry.window.endMin > mustEndBy) {
        breaches.push({ dayIndex: lastIndex, name: entry.name, reason: "departure" });
      } else {
        passed++;
      }
    }
  }

  // `stayBooked` names ONE stay, so only the nights actually spent in it are checked — matching on
  // the name is what keeps a multi-city trip's other, correctly-priced hotels out of the count.
  // Containment in either direction, because the traveler's free text ("Hotel X (already paid)")
  // and the model's tidied name are not reliably prefixes of each other. An empty normalized key
  // is dropped: `"".includes()` is true of everything.
  const booked = normalizeStopName(logistics.stayBooked ?? "");
  if (booked) {
    itinerary.days.forEach((day, dayIndex) => {
      const lodging = day.lodging;
      if (!lodging || lodging.costUsd === null) return;
      const name = normalizeStopName(lodging.name);
      if (!name || (!booked.includes(name) && !name.includes(booked))) return;
      checked++;
      if (lodging.costUsd > 0) {
        breaches.push({ dayIndex, name: lodging.name, reason: "prepaid" });
      } else {
        passed++;
      }
    });
  }

  return { checked, passed, breaches, normalized: checked > 0 ? passed / checked : null };
}

/** `TripLogistics` times are "HH:MM" by contract, so this is the whole of the parse. Deliberately
 *  not `parseItinerary`'s `parseClock`, which is lenient about the 12h forms a *model* writes —
 *  this reads the traveler's own form field, where a looser parse could only mask bad data. */
function parseHhMm(value: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
