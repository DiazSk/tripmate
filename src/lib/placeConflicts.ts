import { parseClock } from "./itinerary";
import type { DayPlan } from "./types";
import type { PlaceFacts } from "./placeFacts";

/** Google's own scale tops out at 100; this is the band it labels "usually as busy as it gets."
 *  Below it is normal tourist traffic, not a defect worth surfacing. */
const CROWD_BUSY_THRESHOLD = 70;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * The weekday a calendar date falls on — **always** via `getUTCDay()`.
 *
 * `new Date("2026-09-10")` is parsed as UTC midnight, so local accessors roll it back a day
 * anywhere west of Greenwich: that date reads Thursday by UTC and Wednesday by `getDay()`.
 * Verified in this repo's own runtime. An off-by-one here doesn't fail loudly — it silently
 * checks the wrong day's hours and manufactures closures that don't exist while missing real
 * ones, which is worse than having no check at all.
 */
export function weekdayOf(isoDate: string): string | null {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return Number.isNaN(day) ? null : WEEKDAYS[day];
}

/** True only when the place publishes hours for that weekday AND they say closed. Absent hours
 *  are "unknown", never "closed" — asserting a closure we can't see is the same class of error as
 *  inventing an opening time. */
export function closedOnDate(facts: PlaceFacts, isoDate: string): boolean {
  const weekday = weekdayOf(isoDate);
  if (!weekday || !facts.hoursByDay) return false;
  const hours = facts.hoursByDay[weekday];
  return typeof hours === "string" && /closed/i.test(hours);
}

/** Busyness at a stop's scheduled hour, from the nearest published bucket. `crowdByDay` is
 *  hourly ("9 AM", "10 AM", ...), a stop's `time` is exact ("2:15 PM"), so this matches to the
 *  closest bucket rather than requiring an exact string match. `null` when there's no crowd data
 *  for that day, or the stop's time doesn't parse — never a guessed number. */
export function crowdLevelAt(facts: PlaceFacts, isoDate: string, timeLabel: string): number | null {
  const weekday = weekdayOf(isoDate);
  const slots = weekday ? facts.crowdByDay?.[weekday] : null;
  if (!slots || slots.length === 0) return null;

  const target = parseClock(timeLabel);
  if (target === null) return null;

  let closest: { time: string; busyness: number | null } | null = null;
  let closestDelta = Infinity;
  for (const slot of slots) {
    const slotMinutes = parseClock(slot.time);
    if (slotMinutes === null) continue;
    const delta = Math.abs(slotMinutes - target);
    if (delta < closestDelta) {
      closestDelta = delta;
      closest = slot;
    }
  }
  return closest?.busyness ?? null;
}

export interface PlaceConflict {
  date: string;
  stopName: string;
  /** The day's published hours, verbatim. Carried so the critique prompt can judge a *time*
   *  clash itself rather than this module shipping a fragile hours parser — see below. */
  publishedHours: string | null;
  /** Set only for `kind: "crowd"`. */
  crowdScore: number | null;
  kind: "closed" | "access" | "crowd";
}

/**
 * Deterministic conflicts only.
 *
 * Day-level closure is unambiguous and gets flagged. Time-of-day clashes deliberately are NOT
 * computed here: published hours run to "9–11 AM, 12–3 PM, 5–8 PM" with en-dashes and split
 * service, and a parser for that is exactly the kind of fragile code that produces confident
 * wrong answers. Instead the day's hours string travels with the conflict into the critique
 * prompt, where a model reads "10:00 AM" against "12–3 PM" reliably. Code does the check it can
 * be certain about; the model does the fuzzy one with real data in hand.
 *
 * `stepFreeRequired` promotes accessibility to a conflict because §9e treats it as a hard
 * constraint, not a preference.
 */
export function detectConflicts(
  days: DayPlan[],
  facts: Map<string, PlaceFacts>,
  opts: { stepFreeRequired?: boolean; crowdBias?: "avoid" | "love" | "mixed" } = {}
): PlaceConflict[] {
  const conflicts: PlaceConflict[] = [];

  for (const day of days) {
    for (const stop of day.stops ?? []) {
      const f = facts.get(normalizeStopName(stop.name));
      if (!f) continue;

      const publishedHours = f.hoursByDay?.[weekdayOf(day.date) ?? ""] ?? null;

      if (closedOnDate(f, day.date)) {
        conflicts.push({ date: day.date, stopName: stop.name, publishedHours, crowdScore: null, kind: "closed" });
      }

      if (
        opts.stepFreeRequired &&
        f.accessibility.length > 0 &&
        !f.accessibility.some((a) => /wheelchair accessible entrance/i.test(a))
      ) {
        conflicts.push({ date: day.date, stopName: stop.name, publishedHours, crowdScore: null, kind: "access" });
      }

      // Only a traveler who asked to avoid crowds gets this — a busy iconic stop isn't a defect
      // for "love" or "mixed", it's the point.
      if (opts.crowdBias === "avoid" && stop.time) {
        const crowdScore = crowdLevelAt(f, day.date, stop.time);
        if (crowdScore !== null && crowdScore >= CROWD_BUSY_THRESHOLD) {
          conflicts.push({ date: day.date, stopName: stop.name, publishedHours: null, crowdScore, kind: "crowd" });
        }
      }
    }
  }

  return conflicts;
}

/** Key stops and facts the same way, so a lookup survives the model's capitalisation and
 *  punctuation drift. */
export function normalizeStopName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Append the fact to the stop's own note, additively — the model's note is its planning rationale
 * and stays. Runs after critique, so it is the guaranteed floor: even when critique fails to move
 * the stop (historically ~35% of calls), the traveler still sees the closure.
 */
export function annotateConflicts(days: DayPlan[], conflicts: PlaceConflict[]): number {
  let applied = 0;
  for (const conflict of conflicts) {
    const day = days.find((d) => d.date === conflict.date);
    const stop = day?.stops?.find((s) => s.name === conflict.stopName);
    if (!stop) continue; // critique replaced or dropped it; nothing to annotate

    const message =
      conflict.kind === "closed"
        ? `Closed on this date${conflict.publishedHours ? ` (published: ${conflict.publishedHours})` : ""} — verify before going.`
        : conflict.kind === "access"
          ? `Step-free access not confirmed here — check before going.`
          : `Usually very busy at this hour — consider an earlier/later time or an off-peak alternative.`;
    if (stop.note?.includes(message)) continue;
    stop.note = stop.note ? `${stop.note} ${message}` : message;
    applied += 1;
  }
  return applied;
}

/**
 * Flags stops that need booking ahead — deterministic, no LLM. `facts.bookAhead` is Google's own
 * "Getting tickets in advance recommended" signal, captured in Phase 2 but never surfaced until
 * now. Runs at the same post-critique point as everything else here, for the same reason: critique
 * can replace the day set wholesale, so annotation has to see whatever it actually returned.
 */
export function annotateBookAhead(days: DayPlan[], facts: Map<string, PlaceFacts>): number {
  const message = "Book ahead — tickets recommended in advance.";
  let applied = 0;
  for (const day of days) {
    for (const stop of day.stops ?? []) {
      const f = facts.get(normalizeStopName(stop.name));
      if (!f?.bookAhead) continue;
      if (stop.note?.includes(message) || /book\s*(ahead|in advance)/i.test(stop.note ?? "")) continue;
      stop.note = stop.note ? `${stop.note} ${message}` : message;
      applied += 1;
    }
  }
  return applied;
}

/**
 * Pin "entry" stop costs to real admission.
 *
 * Measured: a generated Paris itinerary priced the Louvre at $50 against a real $37.39 general
 * adult admission. §3a asks every stop for "a realistic estimated cost" and §5 sums them into the
 * budget target, so an invented entry price is the same defect lodging had, one line item down.
 *
 * Only touches stops with real admission data. A free or unpriced place keeps the model's figure.
 */
export function pinAdmissionCosts(days: DayPlan[], facts: Map<string, PlaceFacts>): number {
  let pinned = 0;
  for (const day of days) {
    for (const stop of day.stops ?? []) {
      // Only ticketed stops. A park, a meal or a transit leg is not an admission, and when
      // step-free access is required EVERY stop gets looked up — so without this filter a free
      // garden picks up whatever price a listing happened to carry.
      if (stop.category !== "entry") continue;
      const f = facts.get(normalizeStopName(stop.name));
      if (!f || f.admissionUsd === null) continue;
      if (stop.cost === f.admissionUsd) continue;
      stop.cost = f.admissionUsd;
      pinned += 1;
    }
  }
  return pinned;
}

/**
 * Which stops are worth a metered lookup.
 *
 * Cost control, and the reason this is a function rather than "enrich everything": the Phase 0
 * spike measured 44 stops on one trip, and a call per stop put a single generation at ~91 metered
 * calls and ~19k added context tokens. `entry` stops are where both hours and admission actually
 * apply. When step-free access is required every stop qualifies, because §9e outranks cost.
 */
export function selectStopsToEnrich(
  days: DayPlan[],
  opts: { stepFreeRequired?: boolean } = {}
): string[] {
  const names = new Set<string>();
  for (const day of days) {
    for (const stop of day.stops ?? []) {
      if (opts.stepFreeRequired || stop.category === "entry") names.add(stop.name);
    }
  }
  return [...names];
}

/**
 * The conflicts, rendered for the critique call.
 *
 * Critique already exists to "find issues and return a corrected day set", so a detected closure
 * belongs in its input rather than in a new mechanism. The published hours travel with each line
 * so it can judge a time-of-day clash this module deliberately doesn't parse.
 *
 * Returns "" when there is nothing to say, leaving the critique prompt byte-identical to before.
 */
export function formatPlaceConflicts(
  conflicts: PlaceConflict[],
  travelMessages: string[] = []
): string {
  if (conflicts.length === 0 && travelMessages.length === 0) return "";

  const lines = conflicts.map((c) => {
    if (c.kind === "closed") {
      return `- ${c.stopName} on ${c.date}: the place is CLOSED that day (published hours: ${c.publishedHours ?? "closed"}).`;
    }
    if (c.kind === "access") {
      return `- ${c.stopName} on ${c.date}: step-free access is not confirmed, and this traveler requires it.`;
    }
    return `- ${c.stopName} on ${c.date}: this traveler asked to avoid crowds, and this stop is usually very busy at its scheduled time (busyness ${c.crowdScore}/100).`;
  });

  // Travel findings are already phrased for a reader by `guardrails.ts`, so they are passed
  // through verbatim rather than re-worded here.
  const all = [...lines, ...travelMessages.map((m) => `- ${m}`)];

  return `
These are verified facts looked up from real listings and real route data, not guesses — each one is a defect in the plan above:
${all.join("\n")}
Fix each by moving the stop to a day or time the place is actually open, or by replacing it with a comparable alternative that is open — keeping the day's geography and pacing sensible. Do not simply reword the note to acknowledge the problem.
`;
}
