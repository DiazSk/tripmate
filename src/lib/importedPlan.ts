/**
 * A traveller's own plan as read from what they dropped in, before TripMate has completed it.
 *
 * Types and two pure helpers, with no server imports, so the Expo app can import it through
 * `@shared/*` without pulling the modules `planImport.ts` needs into its typecheck.
 */

/** A day longer than this is cut, and the cut is reported in `notes`. A guard on a runaway read. */
export const MAX_STOPS_PER_DAY = 12;

export interface ImportedStop {
  name: string;
  /** The traveller's own time, normalised to the app's clock ("2:00 PM"). */
  time?: string;
  /** The traveller's own words about this stop. */
  note?: string;
  /** Set when the stop was found on the map. */
  lat?: number;
  lng?: number;
}

export interface ImportedDay {
  /** `YYYY-MM-DD`, only when the plan stated it. */
  date?: string;
  stops: ImportedStop[];
  /** Where they sleep that night, when the plan says. */
  lodging?: string;
}

export interface ImportedPlan {
  destinationGuess: string | null;
  /** False when what was read is a list of places, not days. */
  isPlan: boolean;
  days: ImportedDay[];
  /** Place names to hand the wizard when `isPlan` is false. */
  loose: string[];
  /** Plan-level reports, e.g. stops left out of a very long day. */
  notes: string[];
  unread: { index: number; reason: string }[];
}

import type { UserAnswers } from "./types";

export interface CompletePlanRequest {
  plan: ImportedPlan;
  destination: string;
  /** Required when any day has no date. */
  startDate?: string;
  budget?: number;
  /** Set only by a catalogue trip saved through this route; absent means an import. */
  origin?: "ready-made";
  /** The catalogue slug, present exactly when `origin` is. */
  readyTrip?: string;
  /** The planner answers a ready-made trip was chosen with, stored as a generated trip's are. */
  userAnswers?: UserAnswers;
}

/** A real `YYYY-MM-DD` calendar date, or undefined. "2026-02-30" is not one. */
export function realDate(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return undefined;
  const s = v.trim();
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? s : undefined;
}
