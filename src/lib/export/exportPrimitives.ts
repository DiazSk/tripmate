import { formatMoney } from "../format";
import { travelLegBetween } from "../travelTime";
import type { Stop, TransportMode } from "../types";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Single-pass escape, applied exactly once at the template boundary.
 *
 * Every string this file interpolates — stop names, notes, day summaries, lodging — is model
 * output, and the artifact is a file the traveler AirDrops to other people. Escaping at the
 * boundary rather than at the source is what makes "did this value get escaped?" answerable by
 * reading one function instead of auditing every call site.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Pictographs, dingbats, and the variation selector that trails them. The model decorates day
 *  summaries ("...museum treasures. 🏛️🍽️") and they read as noise in a printed-feeling
 *  document. Deliberately narrow: accented Latin, em dashes and typographic quotes all survive. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

export function stripEmoji(value: string): string {
  return value.replace(EMOJI, "").replace(/\s+/g, " ").trim();
}

/** DESIGN.md: don't show a label for a value that isn't there. `Food $0 · Entry $0` was the
 *  shape of getting this wrong. */
export function costLabel(cost: number): string {
  return cost > 0 ? formatMoney(cost) : "Free";
}

export interface ExportLeg {
  mode: TransportMode;
  distanceKm: number;
  minutes: number;
}

/**
 * The hops between one day's stops, `null` where there is nothing worth drawing.
 *
 * Two details that bite. First, `travelLegBetween` takes `{ lat, lon }` while `Stop` carries
 * `lng` — the rename is the whole reason this adapter exists. Second, it floors `minutes` at 1,
 * so a pair of stops sharing a coordinate reports "1 min walk" rather than nothing; real
 * itineraries do this constantly (a hotel that appears twice, a summit whose three stops share
 * one point). Suppression therefore keys on the rounded distance, not on minutes.
 */
export function dayLegs(stops: Stop[]): (ExportLeg | null)[] {
  const legs: (ExportLeg | null)[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const leg = travelLegBetween(
      { lat: stops[i].lat, lon: stops[i].lng },
      { lat: stops[i + 1].lat, lon: stops[i + 1].lng }
    );
    legs.push(leg.distanceKm === 0 ? null : leg);
  }
  return legs;
}

/** ASCII-only, so it is safe in a `Content-Disposition` filename without RFC 5987 encoding. */
export function slugify(value: string): string {
  const out = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || "trip";
}
