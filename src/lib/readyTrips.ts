import { cached, TTL } from "./fetchCache";

/**
 * Ready-made trips: the curated catalogue the phone's Home shows under the AI input, kept in Sanity
 * (project `zj8wtfx1`, dataset `production`, document type `readyTrip`; the seed and schema are in
 * `sanity/`).
 *
 * **The dataset is private and only this server reads it.** Clients never talk to Sanity: they ask
 * `/api/ready-trips`, which reads with `SANITY_API_READ_TOKEN` (a Viewer token). That keeps the
 * catalogue off the open internet, keeps the token out of every bundle, and puts one cache between
 * all clients and Sanity's request quota. Fail-soft per the house convention: `null` is "could not
 * ask" (no token, a network error, a non-2xx), `[]` is "asked, nothing published".
 */

export interface ReadyTripStop {
  /** Sanity's `_key` for the array item: a stable list key, unlike the stop's position or name. */
  key: string;
  name: string;
  kind: string;
  note: string;
}

export interface ReadyTripDay {
  key: string;
  day: number;
  theme: string;
  stops: ReadyTripStop[];
}

export interface ReadyTrip {
  slug: string;
  title: string;
  /** "Petra, Jordan": the place, then the country, as the geocoder reads it. */
  destination: string;
  country: string;
  region: string;
  /** The name set big on the card, e.g. "Cinque Terre": Sanity's `shortName`, which the card's
   *  style uppercases. Stored in ordinary case so the data says what the place is called. */
  monument: string;
  days: number;
  /** USD per person, an estimate excluding flights. */
  priceFrom: number;
  priceNote: string;
  pace: string;
  tags: string[];
  weekend: boolean;
  bestMonths: number[];
  summary: string;
  featured: boolean;
  order: number;
  itinerary: ReadyTripDay[];
}

const API_VERSION = "2025-02-19";

const PRICE_NOTE = "Estimate per person, excluding flights";

/**
 * Published documents only, by the request's `perspective=published`. `weekend` is derived from
 * `days` rather than stored beside it, so the two cannot disagree, and the price note is one default
 * here rather than the same sentence on every document.
 */
export const READY_TRIPS_QUERY = /* groq */ `*[_type == "readyTrip"] | order(order asc) {
  "slug": slug.current, title, destination, country, region, "monument": shortName, days, priceFrom,
  "priceNote": coalesce(priceNote, "${PRICE_NOTE}"),
  pace, tags, "weekend": days <= 3, bestMonths, summary, featured, order,
  itinerary[]{ _key, day, theme, stops[]{ _key, name, kind, note } }
}`;

export interface SanityConfig {
  projectId: string;
  dataset: string;
  token: string;
}

/** The project id and dataset are not secrets and default to TripMate's; the token is, and has none. */
export function sanityConfig(env: Record<string, string | undefined> = process.env): SanityConfig | null {
  const token = env.SANITY_API_READ_TOKEN?.trim();
  if (!token) return null;
  return {
    projectId: env.SANITY_PROJECT_ID?.trim() || "zj8wtfx1",
    dataset: env.SANITY_DATASET?.trim() || "production",
    token,
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Sanity's answer, as trips the app can draw. A document missing what a card needs (a slug, a name
 * to set, a length) is dropped rather than drawn half-empty; a stop or day missing its text is
 * dropped from its trip. Anything else is coerced to its type, so one editor's typo cannot throw.
 */
export function parseReadyTrips(raw: unknown): ReadyTrip[] {
  if (!Array.isArray(raw)) return [];
  const trips: ReadyTrip[] = [];
  for (const item of raw) {
    const d = (item ?? {}) as Record<string, unknown>;
    const slug = str(d.slug);
    const monument = str(d.monument);
    const days = num(d.days);
    if (!slug || !monument || days <= 0) continue;
    const itinerary = (Array.isArray(d.itinerary) ? d.itinerary : [])
      .map((x) => {
        const day = (x ?? {}) as Record<string, unknown>;
        const stops = (Array.isArray(day.stops) ? day.stops : [])
          .map((s) => {
            const stop = (s ?? {}) as Record<string, unknown>;
            return { key: str(stop._key), name: str(stop.name), kind: str(stop.kind), note: str(stop.note) };
          })
          .filter((s) => s.name);
        return { key: str(day._key), day: num(day.day), theme: str(day.theme), stops };
      })
      .filter((day) => day.theme);
    trips.push({
      slug,
      title: str(d.title),
      destination: str(d.destination),
      country: str(d.country),
      region: str(d.region),
      monument,
      days,
      priceFrom: num(d.priceFrom),
      priceNote: str(d.priceNote),
      pace: str(d.pace),
      tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === "string") : [],
      weekend: d.weekend === true,
      bestMonths: Array.isArray(d.bestMonths) ? d.bestMonths.filter((m): m is number => typeof m === "number") : [],
      summary: str(d.summary),
      featured: d.featured === true,
      order: num(d.order),
      itinerary,
    });
  }
  return trips;
}

/** The catalogue, cached for an hour: it changes only when an editor publishes. */
export async function fetchReadyTrips(
  config: SanityConfig | null = sanityConfig(),
  fetcher: typeof fetch = fetch
): Promise<ReadyTrip[] | null> {
  if (!config) return null;
  return cached(`readytrips:${config.projectId}:${config.dataset}`, TTL.VOLATILE, async () => {
    const url =
      `https://${config.projectId}.api.sanity.io/v${API_VERSION}/data/query/${config.dataset}` +
      `?query=${encodeURIComponent(READY_TRIPS_QUERY)}&perspective=published`;
    try {
      const res = await fetcher(url, {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { result?: unknown };
      return parseReadyTrips(body.result);
    } catch {
      return null;
    }
  });
}
