import { TTL, cached } from "./fetchCache";

export interface Holiday {
  date: string;
  name: string;
  localName: string;
}

/** Wall-clock cap on each outbound call. Without a signal, undici lets a hung upstream sit for
 *  ~5 minutes and the request that triggered it hangs with it — the literal "the page is stuck"
 *  failure. An abort throws, which is the same shape as any other network failure here, so it
 *  lands on the fail-soft path that already exists rather than adding a new error surface. */
const FETCH_TIMEOUT_MS = 8_000;

/** Free, no-key public holidays API — https://date.nager.at. Fails soft: returns `null` (not
 *  `[]`) on a network error or an unsupported country code, so a caller can tell "fetch failed"
 *  apart from "fetched fine, no holidays in range" — both of which are legitimate `[]`-shaped
 *  outcomes otherwise. */
export async function getPublicHolidays(
  countryCode: string,
  startDate: string,
  endDate: string
): Promise<Holiday[] | null> {
  const startYear = new Date(startDate).getFullYear();
  const endYear = new Date(endDate).getFullYear();
  const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);

  try {
    const perYear = await Promise.all(years.map((year) => holidaysForYear(countryCode, year)));
    if (perYear.every((y) => y === null)) return null;
    return perYear
      .filter((y): y is Holiday[] => y !== null)
      .flat()
      .filter((h) => h.date >= startDate && h.date <= endDate);
  } catch {
    return null;
  }
}

/**
 * One country-year, cached.
 *
 * **The cache sits here rather than around `getPublicHolidays`, and the reshaping is the point.**
 * Keyed on `(countryCode, startDate, endDate)` a cache would almost never hit — every trip has
 * different dates. Keyed on the country-year, two unrelated trips to France in different months
 * share one row, and a trip spanning a new year reuses whichever half it already has.
 *
 * The axis for holidays is *publication*, not freshness: Nager has final data for any year up to
 * the current one and may have nothing at all for a year two out. Returning `null` on `!res.ok`
 * **and** on an empty list is what makes that fall out for free — `cached()` never writes a
 * `null`, so an unpublished year simply re-asks next time instead of being frozen as "this
 * country has no public holidays". No country has no public holidays.
 */
async function holidaysForYear(countryCode: string, year: number): Promise<Holiday[] | null> {
  return cached(`holidays:${countryCode}:${year}`, TTL.STATIC, async () => {
    try {
      const res = await fetch(
        `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
      );
      if (!res.ok) return null;
      const holidays = (await res.json()) as Holiday[];
      return Array.isArray(holidays) && holidays.length ? holidays : null;
    } catch {
      return null;
    }
  });
}
