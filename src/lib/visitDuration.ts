/** No data source carries "typical visit duration" (checked OpenTripMap's xid endpoint and OSM
 *  tags — neither has it), so it's derived from the POI's category. Always flagged
 *  `estimated: true` downstream; these are planning defaults, not facts. Ordered most- to
 *  least-specific, since OpenTripMap `kinds` strings carry several categories at once. */
const DURATION_BY_KIND: { match: RegExp; minutes: number }[] = [
  { match: /theme_parks|water_parks/, minutes: 240 },
  { match: /museums|galleries|aquariums|zoos/, minutes: 120 },
  { match: /castles|fortifications|palaces|archaeology/, minutes: 90 },
  { match: /gardens_and_parks|natural|beaches/, minutes: 75 },
  { match: /temples|churches|mosques|synagogues|religion/, minutes: 45 },
  { match: /view_points|towers|bridges/, minutes: 30 },
  { match: /monuments|sculptures|memorials|historic/, minutes: 20 },
];

const DEFAULT_VISIT_MINUTES = 60;

export function estimateVisitMinutes(kinds: string | null): number {
  if (!kinds) return DEFAULT_VISIT_MINUTES;
  const found = DURATION_BY_KIND.find((d) => d.match.test(kinds));
  return found?.minutes ?? DEFAULT_VISIT_MINUTES;
}
