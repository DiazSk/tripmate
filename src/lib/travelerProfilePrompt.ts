import type { ResolvedFlags, TripLogistics } from "./types";

/**
 * The traveler's answers, rendered as prompt lines. Kept in its own module rather
 * than beside the other `format*` helpers in `itineraryPrompt.ts` for one concrete
 * reason: that file imports `TIERS` as a value, which makes it unloadable from a
 * `.test.mjs` under Node's type-stripping. This is the block that decides whether
 * six screens of questions had any effect, so it gets to be tested.
 *
 * Returns "" for null so an absent `userAnswers` leaves the prompt byte-identical
 * to what it was before this existed — that is what keeps every older caller
 * (PipelineConsole, raw curl) working unchanged.
 *
 * Interests are deliberately NOT repeated here. `formatPreferences` already owns
 * the tag list and its per-tag guidance; this adds only the starred/unstarred
 * ranking, which that helper has no notion of.
 */
export function formatTravelerProfile(flags: ResolvedFlags | null): string {
  if (!flags) return "";

  const lines: string[] = [
    // "About N stops per day" alone is what produced days that ended at 1pm: the model counted
    // meals toward N, so a target of 3 became one sight plus lunch plus dinner and the afternoon
    // simply vanished. Measured — Sonnet 5 on this exact line returned 9:00/11:00/1:00 PM days and
    // was fully compliant while doing it. The count now names what it counts, and the day's SPAN is
    // stated separately, because the two are independent and only one of them was ever specified.
    `Plan about ${flags.paceSpotsPerDay} sightseeing stops per day — the traveler's resolved pace is "${flags.paceResolved}". Meals, coffee and rest breaks do NOT count toward that number; they are additional entries on top of it.`,
    `Each day must still span the whole day, roughly morning through evening. Include lunch around 12:00-13:30 and dinner around 18:30-20:30, and end the day in the evening rather than at lunchtime. A lower stops-per-day target means more time and breathing room per stop — not a day that stops after lunch.`,
  ];

  const mobility = flags.mobilityProfile;
  if (mobility.walkLegCap === "tight") {
    const rules = ["keep walking legs between stops short"];
    if (mobility.minimizeStairs) rules.push("avoid stairs and steep climbs where an alternative exists");
    if (mobility.restBreaks) rules.push("build in sit-down rest breaks");
    if (mobility.preferTransitOverLongWalks) rules.push("prefer transit over any long walk");
    lines.push(`Mobility: ${rules.join("; ")}.`);
  }

  const crowds = flags.crowdBias;
  if (crowds.preferOffpeakTiming || crowds.scheduleIconsAtOffpeak || crowds.boostOffbeatPois) {
    lines.push(
      `Crowds: this traveler avoids them — schedule well-known sights at off-peak hours and favor lesser-known alternatives over headline attractions.`
    );
  } else if (crowds.marketsAndLivelyOk || crowds.peakTimingOk) {
    lines.push(
      `Crowds: this traveler enjoys them — busy markets and lively areas are welcome, and peak-hour timing is fine.`
    );
  }

  lines.push(`Travelling as: ${flags.groupLabel}.`);

  if (flags.partySize !== null) {
    lines.push(
      `Party of ${flags.partySize} — size lodging and any booked table for that many, and prefer stops that can absorb the whole group at once.`
    );
  }

  if (flags.familyRules) {
    const rules = [
      "choose kid-friendly stops",
      "schedule no late-night activities",
      "keep travel legs between stops short",
    ];
    if (flags.familyRules.strollerAccess) {
      rules.push("favour step-free routes and places a pushchair can get into");
    }
    if (flags.familyRules.napWindow) {
      rules.push("leave a real gap in the early afternoon for a nap rather than filling it");
    }
    const band =
      flags.familyRules.youngestBand === "infant"
        ? "Travelling with an infant (under 2)"
        : flags.familyRules.youngestBand === "child"
          ? "Travelling with children (2-11)"
          : "Travelling with kids";
    lines.push(`${band}: ${rules.join(", ")}.`);
  }

  const { primary, tiebreakers } = flags.prioritiesRanked;
  if (primary.length > 0) {
    let line = `Top priorities — these drive which stops are chosen, not just the notes: ${primary.join(", ")}.`;
    if (tiebreakers.length > 0) {
      line += ` Secondary interests, for tie-breaks only: ${tiebreakers.join(", ")}.`;
    }
    lines.push(line);
  }

  return `\nTraveler profile:\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

/**
 * What the traveler has already booked, as the two days it constrains.
 *
 * Returns "" for absent or empty logistics, on the same contract as `formatTravelerProfile`: a
 * traveler who skipped these optional fields gets a byte-identical prompt to the one they'd have
 * got before the fields existed.
 *
 * The 90-minute figure is stated here and in the skill (§4c-bis), and mirrors `TRANSFER_BUFFER_MIN`
 * in the benchmark scorer that checks the model obeyed it.
 */
export function formatTravelLegs(logistics: TripLogistics | null): string {
  if (!logistics) return "";

  const lines: string[] = [];

  if (logistics.arrivalTime || logistics.arrivalPoint) {
    const where = logistics.arrivalPoint ? ` at ${logistics.arrivalPoint}` : "";
    const when = logistics.arrivalTime
      ? `The traveler arrives on day 1 at ${logistics.arrivalTime}${where}. Allow about 90 minutes for immigration, bags and the transfer in, then start the day from there — do not plan anything before that, and keep the first stop close to the arrival point.`
      : `The traveler arrives on day 1${where}. Keep the first stop close to the arrival point.`;
    lines.push(when);
  }

  if (logistics.departureTime || logistics.departurePoint) {
    const where = logistics.departurePoint ? ` from ${logistics.departurePoint}` : "";
    const when = logistics.departureTime
      ? `The traveler departs on the last day at ${logistics.departureTime}${where}. Leave about 90 minutes before that clear for the transfer out, and plan nothing that would run into it.`
      : `The traveler departs on the last day${where}. Keep the last day's stops near the departure point.`;
    lines.push(when);
  }

  if (logistics.stayBooked) {
    lines.push(
      `Lodging is already booked: ${logistics.stayBooked}. Use it for every night instead of choosing one, and route the days around it.`
    );
  }

  if (lines.length === 0) return "";
  return `\nBooked travel:\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}
