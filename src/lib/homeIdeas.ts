import type { IdeaRead } from "./ideaRead";
import type { PlanPrefill } from "./planExamples";
// Type-only: readyTrips.ts reaches the database through fetchCache, and this module is bundled by
// the phone and the client.
import type { ReadyTrip } from "./readyTrips";

/** Lowercase, accents off, punctuation to spaces: "Jerónimos, Monastery!" and "jeronimos monastery" are one. */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The catalogue's wording for pace, in the planner's three. `null` for a word it does not know. */
export function paceFor(pace: string): "relaxed" | "balanced" | "packed" | null {
  switch (pace) {
    case "Easy pace":
    case "Slow":
      return "relaxed";
    case "Balanced":
      return "balanced";
    case "Full days":
      return "packed";
    default:
      return null;
  }
}

/** What the idea box types at an empty traveller, one line after another. */
export const TYPEWRITER_IDEAS = [
  "4 slow days in Lisbon under $2,000",
  "A long weekend somewhere warm with my partner",
  "Petra and Wadi Rum, 5 days, not too rushed",
  "Food trip to Jaipur for two, mid-range",
];

/** One tap fills the box with a sentence the reader is known to read well. */
export const QUICK_PROMPTS = [
  { label: "Weekend away", text: "A weekend away, 2 days, somewhere I can walk everywhere" },
  { label: "Food trip", text: "Food trip to Jaipur for two, mid-range" },
  { label: "Somewhere warm", text: "A long weekend somewhere warm with my partner" },
];

export type Typewriter = { line: number; chars: number; phase: "typing" | "holding" | "deleting" };

const TYPE_MS = 45;
const HOLD_MS = 1800;
const DELETE_MS = 20;

/**
 * One step of the placeholder's typewriter and how long to wait before the next. Pure so the
 * timing is pinned by a test rather than by watching the screen: type, hold the full line, delete
 * faster than it was typed, then the next line (wrapping).
 */
export function typewriterTick(s: Typewriter, lines: string[]): { next: Typewriter; delayMs: number } {
  const length = lines[s.line]?.length ?? 0;
  if (s.phase === "typing") {
    return s.chars < length
      ? { next: { ...s, chars: s.chars + 1 }, delayMs: TYPE_MS }
      : { next: { ...s, phase: "holding" }, delayMs: HOLD_MS };
  }
  if (s.phase === "holding") return { next: { ...s, chars: Math.max(0, s.chars - 1), phase: "deleting" }, delayMs: DELETE_MS };
  return s.chars > 0
    ? { next: { ...s, chars: s.chars - 1 }, delayMs: DELETE_MS }
    : { next: { line: (s.line + 1) % Math.max(1, lines.length), chars: 0, phase: "typing" }, delayMs: TYPE_MS };
}

const words = (s: string) => fold(s).split(" ").filter(Boolean);
/**
 * Whole words with a space either side, so containment is whole-word: " bucharest romania " does
 * not contain " oman ". `''` for text with no words at all.
 */
export const phrase = (s: string) => {
  const w = words(s);
  return w.length ? ` ${w.join(" ")} ` : "";
};

const MAX_MATCHES = 3;
const byOrder = (a: ReadyTrip, b: ReadyTrip) => a.order - b.order;

/**
 * The ready-made trips closest to what a read found: a place that matches in whole words (either
 * way round, so "Lisbon, Portugal" finds a trip to "Lisbon" and "Kyoto" finds "Kyoto, Japan", but
 * "Oman" never finds "Bucharest, Romania") or a shared tag.
 * A trip whose length or price is far from what was asked is dropped rather than ranked low,
 * since a card that cannot fit the sentence is worse than one fewer card.
 */
export function matchTrips(trips: ReadyTrip[], read: IdeaRead): ReadyTrip[] {
  const place = read.destination ? phrase(read.destination) : "";
  const perPerson =
    read.budget === null ? null : read.budgetBasis === "per_person" ? read.budget : read.budget / Math.max(1, (read.adults ?? 1) + (read.children ?? 0));
  // What the traveller ruled out removes the trip outright, place match or not: "no food tours"
  // must not be answered with a food trip. `?? []` for a read from a server older than the field.
  const avoid = (read.avoidTags ?? []) as string[];
  return trips
    .filter((t) => !t.tags.some((tag) => avoid.includes(tag)))
    .map((t) => {
      // An empty field (a trip with no region) would "contain" everything, so it never counts.
      const placeHit =
        place !== "" &&
        [t.destination, t.country, t.region, t.title].map(phrase).some((f) => f !== "" && (f.includes(place) || place.includes(f)));
      const shared = t.tags.filter((tag) => (read.tags as string[]).includes(tag)).length;
      // A named place decides: "California, food" is not answered with a food trip in Italy. Tags
      // alone only choose when the sentence named no place ("somewhere warm, good food").
      return { t, score: (placeHit ? 3 : 0) + shared, candidate: place !== "" ? placeHit : shared > 0 };
    })
    .filter(({ t, candidate }) => candidate && (read.days === null || Math.abs(t.days - read.days) <= 2) && (perPerson === null || t.priceFrom <= perPerson))
    .sort((a, b) => b.score - a.score || byOrder(a.t, b.t))
    .slice(0, MAX_MATCHES)
    .map(({ t }) => t);
}

/**
 * Words a trip idea is full of and a trip's title often shares, which say nothing about the place:
 * "petra and wadi rum" found "Jaipur in pink and gold" on its "and".
 */
const FILLER = new Set([
  "and", "the", "for", "with", "from", "into", "over", "under", "about", "around", "near", "some", "somewhere",
  "day", "days", "night", "nights", "week", "weeks", "weekend", "trip", "trips", "long", "short", "not", "too",
  "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "our", "partner", "friends",
  "budget", "mid", "range", "slow", "fast", "rushed", "that", "this", "where", "can", "all",
]);

/**
 * The offline stand-in for `matchTrips`, for when the reader could not be asked: whole words of
 * three letters or more from what was typed, less `FILLER`, against whole words of a trip's own
 * text. Whole words, so "land" never finds "Islands".
 */
export function keywordTrips(trips: ReadyTrip[], text: string): ReadyTrip[] {
  const wanted = [...new Set(words(text).filter((w) => w.length >= 3 && !FILLER.has(w)))];
  return trips
    .map((t) => {
      const has = new Set([t.destination, t.country, t.region, t.monument, t.title, ...t.tags].flatMap(words));
      return { t, hits: wanted.filter((w) => has.has(w)).length };
    })
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits || byOrder(a.t, b.t))
    .slice(0, MAX_MATCHES)
    .map(({ t }) => t);
}

/** "Here's a start: 4 days in Lisbon · about $1,900", saying only what the sentence did, per person included. */
export function ideaHeadline(read: IdeaRead): string {
  const place = read.destination?.split(",")[0].trim();
  const length = read.days === null ? null : `${read.days} ${read.days === 1 ? "day" : "days"}`;
  // "in" only joins a length to a place: "4 days in Lisbon", but "Lisbon" alone.
  const where = place ? (length ? `in ${place}` : place) : read.kind;
  const parts = [[length, where].filter(Boolean).join(" "), read.budget === null ? "" : `about $${read.budget.toLocaleString("en-US")}${read.budgetBasis === "per_person" ? " per person" : ""}`].filter(Boolean);
  return parts.length ? `Here's a start: ${parts.join(" · ")}` : "Here's a start";
}

/** Calendar-date arithmetic on a 'YYYY-MM-DD' string, in UTC so no zone can roll it a day. */
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);

/** How far ahead a read with a length but no date plans: far enough to book, near enough to mean it. */
export const LEAD_DAYS = 30;

/** Dates for a trip of `days` days, `LEAD_DAYS` out from `today`. */
const leadDates = (today: string, days: number) => {
  const startDate = addDays(today, LEAD_DAYS);
  return { startDate, endDate: addDays(startDate, days - 1) };
};

/** A read's budget and its basis, always together: a null basis is the whole party's, as the card's
 *  headline and `matchTrips` read it, so an earlier attempt's per-person basis cannot linger. */
const budgetFrom = (read: IdeaRead): Pick<PlanPrefill, "budgetUsd" | "budgetBasis"> =>
  read.budget === null ? {} : { budgetUsd: read.budget, budgetBasis: read.budgetBasis ?? "whole_party" };

/**
 * The planner's fields from a read, saying only what the sentence did: a field the reader did not
 * find is absent (not zero), so it cannot overwrite what the traveller's profile already holds.
 * Dates only when the length is known, since a start with no end says nothing.
 */
export function ideaToPrefill(read: IdeaRead, today: string): PlanPrefill {
  // mustInclude always: a sentence never names stops, and a trip chip's from an earlier attempt would ride along.
  const out: PlanPrefill = { destination: read.destination ?? "", startDate: "", endDate: "", mustInclude: "" };
  if (read.days !== null) Object.assign(out, leadDates(today, read.days));
  Object.assign(out, budgetFrom(read));
  if (read.adults !== null) out.adults = read.adults;
  if (read.children !== null) out.children = read.children;
  if (read.pace) out.pace = read.pace;
  if (read.interests.length) out.interests = [...read.interests];
  // `?? []`: a read from a server older than the field.
  if ((read.dietary ?? []).length) out.dietary = [...read.dietary];
  return out;
}

/**
 * The planner's fields from a ready-made trip: the place, its length, its pace and its stops (the
 * must-include list, in the order they are walked). The reading, when there was one, adds the party
 * and the budget it gave; a budget the sentence did not give is never invented.
 */
export function readyTripToPrefill(trip: ReadyTrip, read: IdeaRead | null, today: string): PlanPrefill {
  const out: PlanPrefill = { destination: trip.destination, ...leadDates(today, trip.days) };
  const pace = paceFor(trip.pace);
  if (pace) out.pace = pace;
  const must = trip.itinerary.flatMap((d) => d.stops.map((s) => s.name)).join(", ");
  if (must) out.mustInclude = must;
  if (read) Object.assign(out, budgetFrom(read));
  if (read && read.adults !== null) out.adults = read.adults;
  if (read && read.children !== null) out.children = read.children;
  return out;
}
