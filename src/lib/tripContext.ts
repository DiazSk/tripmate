import type {
  DestinationContext,
  EnrichedPoi,
  PoiDetails,
  ReconciledTrip,
  ReconcileNote,
  TravelLeg,
} from "./types";

/** Above this many legs, listing every pair stops being readable (and cheap) — n POIs produce
 *  n(n-1)/2 legs — so the digest switches to each POI's nearest neighbours, which is what
 *  proximity clustering actually needs. */
const MAX_LEGS_LISTED = 12;
const NEAREST_PER_POI = 3;

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "17:52" out of Open-Meteo's local "2026-09-19T17:52". */
function clockTime(iso: string | null): string | null {
  return iso?.split("T")[1]?.slice(0, 5) ?? null;
}

function noteFor(notes: ReconcileNote[], field: string): ReconcileNote | undefined {
  return notes.find((n) => n.field === field);
}

/** The resolved flags the skill branches on. Written as computed values, not raw answers — the
 *  step-downs have already been applied here, so `pace_resolved` is authoritative and
 *  `explorer_style` is only listed as the intent it started from. */
function flagsSection(trip: ReconciledTrip): string {
  const a = trip.userAnswers;
  const f = trip.resolvedFlags;
  const m = f.mobilityProfile;
  const c = f.crowdBias;

  const lines = [
    `pace_resolved: ${f.paceResolved} (target ${f.paceSpotsPerDay} stops/day)`,
    `mobility_profile: walk_leg_cap=${m.walkLegCap}, minimize_stairs=${m.minimizeStairs}, rest_breaks=${m.restBreaks}, prefer_transit_over_long_walks=${m.preferTransitOverLongWalks}`,
    `crowd_bias: prefer_offpeak_timing=${c.preferOffpeakTiming}, boost_offbeat_pois=${c.boostOffbeatPois}, schedule_icons_at_offpeak=${c.scheduleIconsAtOffpeak}, markets_and_lively_ok=${c.marketsAndLivelyOk}, peak_timing_ok=${c.peakTimingOk}`,
    `priorities_ranked (primary): ${f.prioritiesRanked.primary.length > 0 ? f.prioritiesRanked.primary.join(" > ") : "none starred"}`,
    `priorities_ranked (tie-breakers): ${f.prioritiesRanked.tiebreakers.length > 0 ? f.prioritiesRanked.tiebreakers.join(", ") : "none"}`,
    `group: ${a.group}${a.group === "other" && a.groupOther?.trim() ? ` (${a.groupOther.trim()})` : ""}`,
  ];

  if (a.party) {
    lines.push(
      `party: ${a.party.adults} adults, ${a.party.children} children (2-11), ${a.party.infants} infants (under 2)`
    );
  }
  if (f.partySize !== null) lines.push(`party_size: ${f.partySize}`);

  if (f.familyRules) {
    lines.push(
      `family_rules: kid_friendly_bias=${f.familyRules.kidFriendlyBias}, no_late_night=${f.familyRules.noLateNight}, short_travel_legs=${f.familyRules.shortTravelLegs}, stroller_access=${f.familyRules.strollerAccess}, nap_window=${f.familyRules.napWindow}, youngest_band=${f.familyRules.youngestBand ?? "unknown"}`
    );
  }

  lines.push(
    `explorer_style (stated intent, already applied to pace): ${a.explorerStyle}`,
    `energy: ${a.energy}`,
    `crowds: ${a.crowds}`,
    `budget_usd: ${a.budget}`
  );
  if (a.purpose.trim()) lines.push(`purpose: ${a.purpose.trim()}`);
  return lines.join("\n");
}

/** A hard constraint, not a preference — so it gets its own section rather than riding along in
 *  the flags list where it could read as one more soft signal. "None stated" is written out
 *  explicitly: an absent section would be indistinguishable from a section we forgot to build. */
function dietarySection(trip: ReconciledTrip): string {
  const d = trip.userAnswers.dietary;
  const tags = d?.tags ?? [];
  const note = d?.note?.trim() ?? "";
  if (tags.length === 0 && !note) return "None stated.";
  return [tags.length > 0 ? tags.join(", ") : null, note || null].filter(Boolean).join("; ");
}

/** Stated mobility needs, kept separate from `mobility_profile` in the flags. The flags are the
 *  derived planning knobs; this is what the traveler actually said, which is the thing a stop's
 *  note has to answer to. */
function accessibilitySection(trip: ReconciledTrip): string {
  const a = trip.userAnswers.accessibility;
  if (!a) return "Nothing stated.";
  const parts: string[] = [];
  if (a.stepFreeRequired) parts.push("step-free routes required throughout (hard constraint)");
  if (a.limitStairs && !a.stepFreeRequired) parts.push("avoid stairs and steep climbs where possible");
  if (a.note.trim()) parts.push(a.note.trim());
  return parts.length > 0 ? parts.join("; ") : "Nothing stated.";
}

/** Commitments already made. Listed even when empty so the model can tell "they have no booking"
 *  apart from "we didn't ask" — the first lets it recommend lodging, the second doesn't. */
function logisticsSection(trip: ReconciledTrip): string {
  const l = trip.userAnswers.logistics;
  const lines: string[] = [];
  if (l?.stayBooked?.trim()) {
    lines.push(`booked_lodging: ${l.stayBooked.trim()} — already paid for, cost 0, every night`);
  }
  if (l?.arrivalTime?.trim()) lines.push(`arrival_time (day 1, local): ${l.arrivalTime.trim()}`);
  if (l?.departureTime?.trim()) {
    lines.push(`departure_time (last day, local): ${l.departureTime.trim()}`);
  }
  return lines.length > 0 ? lines.join("\n") : "Nothing booked or stated — lodging is yours to choose.";
}

/** Model-sourced (one cached LLM call), so it is ranked below the fetched facts above and labelled
 *  as background rather than ground truth. Reaches the staged pipeline only since this section
 *  existed; before it, the skill's destination-context branch could never fire. */
function destinationContextSection(ctx: DestinationContext | null): string {
  if (!ctx) return "Unavailable.";
  const lines: string[] = [];
  if (ctx.festivals.length > 0) {
    lines.push(
      ...ctx.festivals.map((f) => `- festival: ${f.name} (${f.dates}) — ${f.note}`)
    );
  }
  if (ctx.safety.length > 0) {
    lines.push(...ctx.safety.map((x) => `- safety [${x.severity}]: ${x.note}`));
  }
  if (ctx.shopping.length > 0) {
    lines.push(...ctx.shopping.map((x) => `- shopping: ${x.name} (${x.area}) — ${x.note}`));
  }
  if (ctx.trends.length > 0) lines.push(...ctx.trends.map((x) => `- trend: ${x.note}`));
  if (lines.length === 0) return "Fetched, nothing notable for these dates.";
  return ["(background, model-sourced — weigh it below the fetched facts above)", ...lines].join("\n");
}

function destinationSection(trip: ReconciledTrip): string {
  const d = trip.rawFetch.destination;
  if (!d.resolved) {
    return "Coordinates unresolved — distances and weather below are unverified.";
  }
  const parts = [d.region ?? "location unknown", `${d.lat?.toFixed(4)}, ${d.lon?.toFixed(4)}`];
  if (d.timezone) parts.push(`timezone ${d.timezone}`);
  return parts.join(" — ");
}

function datesSection(trip: ReconciledTrip): string {
  const dc = trip.rawFetch.dateContext;
  const lines = [
    `${dc.tripDays} days, ${dc.days[0]?.date} to ${dc.days[dc.days.length - 1]?.date} (${dc.leadTimeDays} days out${dc.season ? `, ${dc.season}` : ""})`,
  ];

  // Facts only, per the pipeline's separation — what to do about a late arrival is §4c-bis of the
  // skill, not a line here.
  const l = trip.userAnswers.logistics;
  if (l) {
    if (l.arrivalTime || l.arrivalPoint) {
      lines.push(
        `arrival (day 1): ${l.arrivalTime ?? "time unknown"}${l.arrivalPoint ? ` at ${l.arrivalPoint}` : ""}`
      );
    }
    if (l.departureTime || l.departurePoint) {
      lines.push(
        `departure (last day): ${l.departureTime ?? "time unknown"}${l.departurePoint ? ` from ${l.departurePoint}` : ""}`
      );
    }
    if (l.stayBooked) lines.push(`lodging already booked: ${l.stayBooked}`);
  }

  return lines.join("\n");
}

/** One line per day: weather + sunset, the two facts the skill schedules against. */
function weatherSection(trip: ReconciledTrip): string {
  const w = trip.rawFetch.weather;
  const tripDays = trip.rawFetch.dateContext.days;

  if (!w.available || w.days.length === 0) {
    const note = noteFor(trip.notes, "weather");
    return `Unavailable — ${note?.detail ?? "plan against seasonal norms."}`;
  }

  const lines = w.days.map((d, i) => {
    // The historical fallback reports LAST year's calendar dates (weather.ts re-queries the same
    // dates a year back), so labelling rows with their own `date` would put the wrong date — and
    // the wrong day-of-week — in front of the model. Rows are chronological and 1:1 with the trip
    // days, so position is what identifies them; fall back to the row's own date only if the
    // lengths ever disagree.
    const tripDay = tripDays[i];
    const date = tripDay?.date ?? d.date;
    const weekday = tripDay?.dayOfWeek ?? WEEKDAY_SHORT[new Date(d.date).getUTCDay()];
    const bits = [`${Math.round(d.tempMinC)}-${Math.round(d.tempMaxC)}C`];
    if (d.precipitationProbability !== null) bits.push(`${d.precipitationProbability}% rain`);
    const sunset = clockTime(d.sunset);
    const sunrise = clockTime(d.sunrise);
    if (sunrise && sunset) bits.push(`daylight ${sunrise}-${sunset}`);
    return `- ${date} ${weekday}: ${bits.join(", ")}`;
  });

  const caveat = w.historical
    ? "(estimated — trip is beyond the forecast horizon, these are same-dates-last-year averages)"
    : "";
  return [caveat, ...lines].filter(Boolean).join("\n");
}

function holidaysSection(trip: ReconciledTrip): string {
  const h = trip.rawFetch.holidays;
  if (!h.available) return "Unavailable — closures and crowding can't be anticipated.";
  if (h.events.length === 0) return "None during the trip window.";
  return h.events.map((e) => `- ${e.date}: ${e.name}`).join("\n");
}

function transportSection(trip: ReconciledTrip): string {
  const note = noteFor(trip.notes, "transportModes");
  const modes = trip.transportModes.join(", ");
  return note ? `${modes} (assumed — no transport data for this destination)` : modes;
}

function poiLine(p: EnrichedPoi): string {
  const bits: string[] = [];
  if (p.lat !== null && p.lon !== null) bits.push(`${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`);
  else bits.push("coordinates unknown");

  if (p.openingHours) bits.push(`open ${p.openingHours}`);
  else bits.push("hours unknown — verify before visiting");

  if (p.closedDays && p.closedDays.length > 0) bits.push(`closed ${p.closedDays.join("/")}`);

  bits.push(`~${p.visitMinutes} min${p.visitMinutesEstimated ? " (est)" : ""}`);

  // Only stated when OSM actually has the tag. Silence means unknown, never "no" — routing someone
  // with a step-free requirement to a place we merely failed to look up is the failure to avoid.
  if (p.wheelchair) bits.push(`wheelchair ${p.wheelchair}`);

  return `- ${p.name} — ${bits.join(" — ")}`;
}

function legLine(l: TravelLeg): string {
  return `- ${l.from} -> ${l.to}: ${l.minutes} min ${l.mode} (${l.distanceKm} km)`;
}

/** Full pair list while it stays short; otherwise each POI's nearest few, which preserves the
 *  cluster structure at a fraction of the lines. */
function travelSection(details: PoiDetails): string {
  const legs = details.travelLegs;
  if (legs.length === 0) return "No travel times — fewer than two places have coordinates.";

  const header = "(estimated — straight-line distance with a road-circuity correction)";

  if (legs.length <= MAX_LEGS_LISTED) {
    const sorted = [...legs].sort((a, b) => a.minutes - b.minutes);
    return [header, ...sorted.map(legLine)].join("\n");
  }

  const names = Array.from(new Set(legs.flatMap((l) => [l.from, l.to])));
  const lines = names.map((name) => {
    const nearest = legs
      .filter((l) => l.from === name || l.to === name)
      .sort((a, b) => a.minutes - b.minutes)
      .slice(0, NEAREST_PER_POI)
      .map((l) => `${l.from === name ? l.to : l.from} ${l.minutes}min`);
    return `- ${name} -> ${nearest.join(", ")}`;
  });
  return [`${header} Nearest neighbours per place:`, ...lines].join("\n");
}

/**
 * Step 5 — deterministic digest of the Step 3 + Step 4 bundles into `trip-context.md`.
 *
 * Facts only: no planning instructions and no "how to plan" guidance, because that all lives in
 * the itinerary-planner skill. Every degraded field states its default inline and is marked, so
 * the model is never left guessing silently at what's missing.
 */
export function buildTripContext(
  trip: ReconciledTrip,
  details: PoiDetails,
  destinationContext: DestinationContext | null = null
): string {
  const unknownPois = details.pois.filter((p) => p.partial).length;

  return `# Trip Context

## Flags
${flagsSection(trip)}

## Dietary needs
${dietarySection(trip)}

## Accessibility
${accessibilitySection(trip)}

## Fixed commitments
${logisticsSection(trip)}

## Destination
${destinationSection(trip)}

## Dates
${datesSection(trip)}

## Weather
${weatherSection(trip)}

## Holidays and events
${holidaysSection(trip)}

## Transport modes
${transportSection(trip)}

## Anchor places (optional, traveler-chosen)
${
  details.pois.length === 0
    ? "None — every stop is to be chosen from the traveler profile above."
    : `${details.pois.map(poiLine).join("\n")}${
        unknownPois > 0
          ? `\n(${unknownPois} of ${details.pois.length} have incomplete details — treat unknown hours as needing verification)`
          : ""
      }`
}

## Travel times
${travelSection(details)}

## Destination background
${destinationContextSection(destinationContext)}
`;
}
