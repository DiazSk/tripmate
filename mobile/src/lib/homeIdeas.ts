import type { IdeaRead } from '@shared/ideaRead';
import type { ReadyTrip } from '@shared/readyTrips';

import { fold } from '@/lib/ownPlan';
import type { PlanPrefillParams } from '@/lib/planDraft';
import { paceFor } from '@/lib/readyTrips';

/** What the idea box types at an empty traveller, one line after another. */
export const TYPEWRITER_IDEAS = [
  '4 slow days in Lisbon under $2,000',
  'A long weekend somewhere warm with my partner',
  'Petra and Wadi Rum, 5 days, not too rushed',
  'Food trip to Jaipur for two, mid-range',
];

/** One tap fills the box with a sentence the reader is known to read well. */
export const QUICK_PROMPTS = [
  { label: 'Weekend away', text: 'A weekend away, 2 days, somewhere I can walk everywhere' },
  { label: 'Food trip', text: 'Food trip to Jaipur for two, mid-range' },
  { label: 'Somewhere warm', text: 'A long weekend somewhere warm with my partner' },
];

export type Typewriter = { line: number; chars: number; phase: 'typing' | 'holding' | 'deleting' };

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
  if (s.phase === 'typing') {
    return s.chars < length
      ? { next: { ...s, chars: s.chars + 1 }, delayMs: TYPE_MS }
      : { next: { ...s, phase: 'holding' }, delayMs: HOLD_MS };
  }
  if (s.phase === 'holding') return { next: { ...s, chars: Math.max(0, s.chars - 1), phase: 'deleting' }, delayMs: DELETE_MS };
  return s.chars > 0
    ? { next: { ...s, chars: s.chars - 1 }, delayMs: DELETE_MS }
    : { next: { line: (s.line + 1) % Math.max(1, lines.length), chars: 0, phase: 'typing' }, delayMs: TYPE_MS };
}

const MAX_MATCHES = 3;
const byOrder = (a: ReadyTrip, b: ReadyTrip) => a.order - b.order;

/**
 * The ready-made trips closest to what a read found: a place that matches (either way round, so
 * "Lisbon, Portugal" finds a trip to "Lisbon" and "Kyoto" finds "Kyoto, Japan") or a shared tag.
 * A trip whose length or price is far from what was asked is dropped rather than ranked low,
 * since a card that cannot fit the sentence is worse than one fewer card.
 */
export function matchTrips(trips: ReadyTrip[], read: IdeaRead): ReadyTrip[] {
  const place = read.destination ? fold(read.destination) : '';
  const perPerson =
    read.budget === null ? null : read.budgetBasis === 'per_person' ? read.budget : read.budget / Math.max(1, (read.adults ?? 1) + (read.children ?? 0));
  return trips
    .map((t) => {
      // An empty field (a trip with no region) would "contain" everything, so it never counts.
      const placeHit =
        place !== '' &&
        [t.destination, t.country, t.region, t.title].map(fold).some((f) => f !== '' && (f.includes(place) || place.includes(f)));
      const shared = t.tags.filter((tag) => (read.tags as string[]).includes(tag)).length;
      return { t, score: (placeHit ? 3 : 0) + shared, candidate: placeHit || shared > 0 };
    })
    .filter(({ t, candidate }) => candidate && (read.days === null || Math.abs(t.days - read.days) <= 2) && (perPerson === null || t.priceFrom <= perPerson))
    .sort((a, b) => b.score - a.score || byOrder(a.t, b.t))
    .slice(0, MAX_MATCHES)
    .map(({ t }) => t);
}

const words = (s: string) => fold(s).split(' ').filter(Boolean);

/**
 * The offline stand-in for `matchTrips`, for when the reader could not be asked: whole words of
 * three letters or more from what was typed against whole words of a trip's own text. Whole words,
 * so "and" never finds "Islands".
 */
export function keywordTrips(trips: ReadyTrip[], text: string): ReadyTrip[] {
  const wanted = [...new Set(words(text).filter((w) => w.length >= 3))];
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

/** "Here's a start: 4 days in Lisbon · about $1,900", saying only what the sentence did. */
export function ideaHeadline(read: IdeaRead): string {
  const place = read.destination?.split(',')[0].trim();
  const length = read.days === null ? null : `${read.days} ${read.days === 1 ? 'day' : 'days'}`;
  // "in" only joins a length to a place: "4 days in Lisbon", but "Lisbon" alone.
  const where = place ? (length ? `in ${place}` : place) : read.kind;
  const parts = [[length, where].filter(Boolean).join(' '), read.budget === null ? '' : `about $${read.budget.toLocaleString('en-US')}`].filter(Boolean);
  return parts.length ? `Here's a start: ${parts.join(' · ')}` : "Here's a start";
}

/** Calendar-date arithmetic on a 'YYYY-MM-DD' string, in UTC so no zone can roll it a day. */
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);

/** How far ahead a read with a length but no date plans: far enough to book, near enough to mean it. */
const LEAD_DAYS = 30;

/** The planner's fields from a read. Dates only when the length is known, since a start with no end says nothing. */
export function ideaPrefill(read: IdeaRead, today: string): PlanPrefillParams {
  const out: PlanPrefillParams = {};
  if (read.destination) out.destination = read.destination;
  if (read.days !== null) {
    out.start = addDays(today, LEAD_DAYS);
    out.end = addDays(out.start, read.days - 1);
  }
  if (read.budget !== null) out.budget = String(read.budget);
  if (read.adults !== null) out.adults = String(read.adults);
  if (read.children !== null) out.children = String(read.children);
  if (read.pace) out.pace = read.pace;
  if (read.interests.length) out.into = read.interests.join(',');
  return out;
}

/** The planner's fields from a ready-made trip: its stops become the must-include list, in the order they are walked. */
export function readyTripPrefill(trip: ReadyTrip, start: string | null): PlanPrefillParams {
  const out: PlanPrefillParams = { destination: trip.destination };
  const pace = paceFor(trip.pace);
  if (pace) out.pace = pace;
  const must = trip.itinerary.flatMap((d) => d.stops.map((s) => s.name)).join(', ');
  if (must) out.must = must;
  if (start) {
    out.start = start;
    out.end = addDays(start, trip.days - 1);
  }
  return out;
}

/** `priceFrom` is per person, so the whole party's budget is that times the head count. */
export const suggestedBudget = (trip: ReadyTrip, people: number): number => trip.priceFrom * Math.max(1, people);
