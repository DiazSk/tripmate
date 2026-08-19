import type { ResolvedFlags } from "./types";

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

  if (flags.familyRules) {
    lines.push(
      `Travelling with kids: choose kid-friendly stops, schedule no late-night activities, and keep travel legs between stops short.`
    );
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
