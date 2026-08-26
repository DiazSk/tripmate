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
    const perYear = await Promise.all(
      years.map(async (year) => {
        const res = await fetch(
          `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
          { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
        );
        if (!res.ok) return null;
        return (await res.json()) as Holiday[];
      })
    );
    if (perYear.every((y) => y === null)) return null;
    return perYear
      .filter((y): y is Holiday[] => y !== null)
      .flat()
      .filter((h) => h.date >= startDate && h.date <= endDate);
  } catch {
    return null;
  }
}
