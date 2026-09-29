import type { Stop } from "./types";

/**
 * What a fact on screen is standing on.
 *
 * TripMate puts a measured coordinate, an arithmetic result, a traveller's own entry and a
 * sentence the model wrote into the same rows, in the same voice. A reader has no way to tell
 * them apart, and the consequence changed when the app became something people consult while
 * physically executing a plan: "this place is usually quick" is mildly annoying at the planning
 * desk and operational guidance on a street in Lisbon.
 *
 * **This is a vocabulary, not a badge.** The point is that one module decides what kind of fact
 * each thing is, so two surfaces cannot quietly disagree — the same failure the repo already
 * fixed once by making `legFit` the single subtraction behind travel, overlap and commitment
 * findings. `src/components/bench/BenchConsole.tsx` reached for the same idea first, labelling
 * scorer families DETERMINISTIC / MEASURED / MODEL-JUDGED; this is that instinct made shared.
 */
export type Evidence =
  /** A real listing said so — OpenStreetMap, the geocoder, a POI lookup. */
  | "sourced"
  /** This app's own arithmetic over the plan. Reproducible, and wrong only if the inputs are. */
  | "computed"
  /** Fetched for these dates and ages. A cached one is not still true. */
  | "live"
  /** The traveller said so. The only kind nothing may overwrite. */
  | "entered"
  /** The model wrote it. Worth reading, and not evidence of anything. */
  | "planner";

/** Two words, for a screen. Deliberately plain: a reader should not need the docs. */
export const EVIDENCE_LABEL: Record<Evidence, string> = {
  sourced: "from a listing",
  computed: "calculated",
  live: "fetched",
  entered: "you entered",
  planner: "the planner's",
};

/**
 * How a stop's position came to be what it is.
 *
 * Recorded rather than derived, because it is the one thing here nothing can reconstruct later:
 * the placing sweep resolves a stop's name against OpenStreetMap and overwrites the coordinate
 * on a hit, and that outcome was being discarded the moment it was known.
 *
 * **`"model"` is written on a miss, deliberately, rather than leaving the field absent.** Absent
 * has to keep meaning "this plan predates the field" — every itinerary already on disk is in
 * that state — and a miss is a different thing: a check ran and found nothing. Collapsing them
 * would make an old plan indistinguishable from an unverifiable one.
 */
export type Located =
  /** The name resolved against OpenStreetMap and the coordinate is that listing's. */
  | "osm"
  /** Added from a place search, so the name, coordinate and category are all the listing's. */
  | "search"
  /** The sweep ran and did not match. The coordinate is the planner's estimate. */
  | "model";

/**
 * What to say under a stop about where it is.
 *
 * Null for a plan saved before any of this was recorded — saying "estimated" there would assert
 * that a check failed when no check ran, which is the error `planHealth` avoids by printing
 * "Not checked" instead of 100.
 *
 * **A miss is not an accusation.** Measured against a real seven-day Lisbon plan, 11 of 41 stops
 * resolve — and most of the 30 are unresolvable *by design*: the skill's §3b food rule makes
 * meals area-level ("Lunch around Alfama") rather than a named restaurant, and a transit leg
 * ("Tram 15E to Belém") was never a place. So this states the outcome and lets the reader judge
 * it, rather than grading it. "The planner's estimate" is true and useful of an area stop too:
 * it says do not navigate precisely to this pin.
 */
export function locationNote(located: Located | undefined): { value: string; evidence: Evidence } | null {
  switch (located) {
    case "osm":
      return { value: "Location confirmed against OpenStreetMap", evidence: "sourced" };
    case "search":
      return { value: "Chosen from a place search", evidence: "sourced" };
    case "model":
      return { value: "Location is the planner's estimate", evidence: "planner" };
    default:
      return null;
  }
}

export interface StopFact {
  label: string;
  value: string;
  evidence: Evidence;
}

/**
 * Every fact a stop is carrying, each tagged with what it stands on.
 *
 * The single source of truth for the question "what kind of fact is this", so a surface renders
 * provenance rather than deciding it. Today the day page draws only the location line from this;
 * the rest exists so the next surface — a stop sheet, the web client — reads the same answer
 * instead of inventing its own.
 *
 * **Travel is passed in, not computed here.** `dayTravel` already owns the one priced hop, and a
 * second implementation is how two screens start quoting different numbers for the same leg.
 *
 * **`live` is empty at stop level, and that is stated rather than faked.** Weather is the only
 * live fact this app holds and it belongs to a day, not a stop. A category with nothing in it is
 * worth keeping in the vocabulary — it is where an opening-state lookup would land — and worth
 * not inventing members for.
 */
export function stopEvidence(
  stop: Stop & { located?: Located },
  ctx: {
    /** Minutes for the leg arriving at this stop, from `dayTravel`. */
    travelMinutes?: number | null;
    travelMode?: string | null;
    /** When to leave the previous stop, from `dayTravel`. */
    leaveBy?: string | null;
  } = {}
): StopFact[] {
  const facts: StopFact[] = [];

  const where = locationNote(stop.located);
  if (where) facts.push({ label: "Location", value: where.value, evidence: where.evidence });

  // The note is the planner's prose on a generated stop and the listing's own facts on one added
  // from search — `addPlaceToDay` fills it from `describePlace`. Same field, opposite footing,
  // which is exactly the conflation this module exists to resolve.
  if (stop.note?.trim()) {
    facts.push({
      label: "Detail",
      value: stop.note.trim(),
      evidence: stop.located === "search" ? "sourced" : "planner",
    });
  }
  if (stop.why?.trim()) {
    facts.push({ label: "Why here", value: stop.why.trim(), evidence: "planner" });
  }

  if (typeof ctx.travelMinutes === "number") {
    facts.push({
      label: "Getting here",
      value: ctx.travelMode ? `${ctx.travelMinutes} min by ${ctx.travelMode}` : `${ctx.travelMinutes} min`,
      evidence: "computed",
    });
  }
  if (ctx.leaveBy) {
    facts.push({ label: "Leave by", value: ctx.leaveBy, evidence: "computed" });
  }

  // The planner writes a party-total estimate; a corrected figure is the traveller's own.
  if (typeof stop.actualCost === "number") {
    facts.push({ label: "Cost", value: `${stop.actualCost}`, evidence: "entered" });
  } else if (stop.cost > 0) {
    facts.push({ label: "Cost", value: `${stop.cost}`, evidence: "planner" });
  }

  // Only the traveller's own commitment. The model may write FIXED for something they named as
  // booked, which is still their statement rather than its judgement.
  if (stop.timeFlexibility === "FIXED") {
    facts.push({ label: "Booked", value: "Will not be moved", evidence: "entered" });
  }

  return facts;
}

/**
 * The standing sentence for a screen full of stops.
 *
 * Said once rather than per stop. The prose is the planner's on essentially every generated
 * stop, and a disclaimer repeated forty times is one nobody reads by the third — the same reason
 * Plan Health's coverage line sits above the findings rather than beside each one.
 */
export const EVIDENCE_FOOTNOTE =
  "Descriptions are written by the planner. Locations say so where a listing confirmed them.";
