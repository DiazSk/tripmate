import { listTripItineraries } from "./db";
import { normalizeDays, tripSpend } from "./itinerary";

export interface ProfileStats {
  trips: number;
  places: number;
  spend: number;
}

/**
 * What somebody's kept trips add up to.
 *
 * Extracted from `GET /api/profile/stats` so `/profile` can render the figures in its first paint
 * rather than mounting and fetching them — the same promise the rest of that page already makes
 * (`profile/page.tsx`: "the first paint is already correct"). The route still exists and still
 * serves the mobile client; it now calls this instead of holding the logic, so the two surfaces
 * cannot drift into reporting different totals for the same account.
 *
 * **`places`, not "countries".** `destination` is free text and there is no country on the row —
 * the iOS app's old trick of taking the last comma-separated part makes "Tokyo" a country called
 * Tokyo. The honest figure is the number of distinct destinations, and "places" is already the
 * word the memories header uses.
 *
 * **`spend` is real spend**, through the same `tripSpend` the trip screen's budget bar uses, so a
 * cost the traveller corrected counts here too and the two surfaces cannot disagree.
 */
export function profileStats(ownerId: string, signedIn: boolean): ProfileStats {
  const rows = listTripItineraries(ownerId, signedIn);

  let spend = 0;
  for (const row of rows) {
    try {
      // `String(...)` before parsing, and it is not ceremony. SQLite columns are typed per *value*,
      // so `itinerary_json` holds TEXT for every row written through this app — but anything that
      // writes it with the CLI's `readfile()` stores a BLOB instead, and libsql hands a BLOB back
      // as a Buffer. `JSON.parse(buffer)` throws, which a `catch` here turns into a trip worth
      // zero: a wrong lifetime total, reported confidently, with nothing on screen to say so.
      const parsed = JSON.parse(String(row.itinerary_json)) as { days?: unknown };
      spend += tripSpend(normalizeDays(parsed?.days));
    } catch (err) {
      // Genuinely broken JSON. Still counted in `trips` — somebody kept it — but it adds nothing
      // to the money, and it gets logged rather than vanishing, because a silently missing trip is
      // indistinguishable from a cheap one.
      console.error(`[profileStats] unparseable itinerary for ${row.destination}`, err);
    }
  }

  return {
    trips: rows.length,
    places: new Set(rows.map((row) => row.destination)).size,
    spend,
  };
}
