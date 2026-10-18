import type { CandidatePoi } from "./pois";

/** "Mumbai, India" -> "Mumbai". */
export const cityOf = (destination: string) => destination.split(",")[0]?.trim() ?? "";

/**
 * Example text for "The specifics", drawn from the traveller's own destination so a Mumbai
 * trip is never coached with the Louvre. Candidate POIs arrive late (or never, without an
 * OpenTripMap key), so the must-see example falls back to place-free wording.
 */
export function specificsPlaceholders(destination: string, pois: CandidatePoi[], poisAvailable: boolean) {
  const city = cityOf(destination);
  const names = poisAvailable ? pois.slice(0, 2).map((p) => p.name) : [];
  return {
    purpose: `An anniversary, a first time in ${city || "a new city"}, work and play`,
    mustInclude: names.length === 2 ? names.join(", ") : "A landmark, a market, a viewpoint",
  };
}
