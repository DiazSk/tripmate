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
    `Plan about ${flags.paceSpotsPerDay} stops per day — the traveler's resolved pace is "${flags.paceResolved}". Treat it as a target, not a minimum: fewer, better-chosen stops beat a day they cannot finish.`,
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
