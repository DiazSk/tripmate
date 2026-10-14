import type { TripSummary } from "./types";
import { DRAFT_TTL_DAYS } from "./drafts";

/**
 * The words the memories wall says about a trip: where it stands against today, the postmark it
 * carries, how long a draft has left. Calendar dates are read in UTC (see the Gotchas in CLAUDE.md:
 * a local read rolls a date back a day west of Greenwich). `today` is a parameter so this is
 * testable without freezing the clock.
 */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY_MS = 86_400_000;

/** Whole UTC days since the epoch, for a calendar date or a full ISO timestamp. */
const dayNum = (iso: string) => Math.floor(Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso) / DAY_MS);

export const city = (t: Pick<TripSummary, "destination">) => t.destination.split(",")[0].trim();
export const country = (t: Pick<TripSummary, "destination">) => t.destination.split(",").slice(1).join(",").trim();

export function postmark(t: Pick<TripSummary, "startDate">) {
  const [y, m] = t.startDate.split("-");
  return { month: MONTHS[Number(m) - 1] ?? "", year: y };
}

export type Phase = "upcoming" | "now" | "past";
export function phase(t: Pick<TripSummary, "startDate" | "endDate">, today = new Date()): Phase {
  const d = dayNum(today.toISOString());
  if (dayNum(t.endDate) < d) return "past";
  return dayNum(t.startDate) > d ? "upcoming" : "now";
}

/** "In 30 days", "Tomorrow", "Happening now", or "Remembered" once it is over. */
export function phaseLine(t: Pick<TripSummary, "startDate" | "endDate">, today = new Date()): string {
  const p = phase(t, today);
  if (p === "now") return "Happening now";
  if (p === "past") return "Remembered";
  const n = dayNum(t.startDate) - dayNum(today.toISOString());
  return n === 1 ? "Tomorrow" : `In ${n} days`;
}

/** How long an unkept draft has before `purgeStaleDrafts` sweeps it, or null with no `createdAt`. */
export function clearsIn(t: Pick<TripSummary, "createdAt">, today = new Date()): string | null {
  if (!t.createdAt) return null;
  const n = DRAFT_TTL_DAYS - (dayNum(today.toISOString()) - dayNum(t.createdAt));
  return n <= 1 ? "Cleared tomorrow unless you keep it" : `Cleared in ${n} days unless you keep it`;
}

/** The hero's sentence: "6 trips remembered, from Sinaia to Engadin." Oldest first, by start date. */
export function rememberedLine(trips: TripSummary[]): string {
  if (!trips.length) return "";
  const byDate = [...trips].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const first = city(byDate[0]);
  const last = city(byDate[byDate.length - 1]);
  const count = `${trips.length} ${trips.length === 1 ? "trip" : "trips"} remembered`;
  return first === last ? `${count}, starting with ${first}.` : `${count}, from ${first} to ${last}.`;
}

/** The trip the hero stands on: the next one still to come, else the one that started last. */
export function featured(trips: TripSummary[], today = new Date()): TripSummary | null {
  const ahead = trips
    .filter((t) => phase(t, today) !== "past")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return ahead[0] ?? [...trips].sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null;
}
