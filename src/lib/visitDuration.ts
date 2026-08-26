/** No data source carries "typical visit duration" (checked OpenTripMap's xid endpoint and OSM
 *  tags — neither has it), so it's derived from the POI's category. Always flagged
 *  `estimated: true` downstream; these are planning defaults, not facts. Ordered most- to
 *  least-specific, since OpenTripMap `kinds` strings carry several categories at once. */
const DURATION_BY_KIND: { match: RegExp; minutes: number }[] = [
  { match: /theme_parks|water_parks|national_parks/, minutes: 240 },
  { match: /museums|galleries|aquariums|zoos|botanical_gardens/, minutes: 120 },
  { match: /castles|fortifications|palaces|archaeology|unesco|historic_house/, minutes: 90 },
  { match: /markets|bazaars|shops|malls/, minutes: 80 },
  { match: /gardens_and_parks|natural|beaches|hiking|nature_reserves/, minutes: 75 },
  { match: /temples|churches|cathedrals|mosques|synagogues|monasteries|religion/, minutes: 60 },
  { match: /theatres|concert_halls|stadiums/, minutes: 120 },
  { match: /view_points|towers|bridges/, minutes: 40 },
  { match: /monuments|sculptures|memorials|fountains/, minutes: 20 },
  // `historic` last and on its own: OpenTripMap attaches it to nearly every cultural site,
  // including 2-hour castles. Matching it earlier is what put Nijo Castle at 20 minutes and
  // then scheduled exactly 20 minutes for it.
  { match: /historic/, minutes: 60 },
];

const DEFAULT_VISIT_MINUTES = 60;

/** The LONGEST match wins, not the first. `kinds` carries several categories at once, and a place
 *  tagged `castles,historic,monuments` deserves the castle's 90 minutes rather than whichever row
 *  happens to sit highest in the list. Under-booking a stop is the costlier error: the traveler
 *  arrives, finds they have 20 minutes for a two-hour castle, and the rest of the day slides. */
export function estimateVisitMinutes(kinds: string | null): number {
  if (!kinds) return DEFAULT_VISIT_MINUTES;
  const matched = DURATION_BY_KIND.filter((d) => d.match.test(kinds)).map((d) => d.minutes);
  return matched.length > 0 ? Math.max(...matched) : DEFAULT_VISIT_MINUTES;
}
