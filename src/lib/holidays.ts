export interface Holiday {
  date: string;
  name: string;
  localName: string;
}

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
        const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`);
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
