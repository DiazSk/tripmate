import type { Evidence, EvidencePlace, EvidenceSource, QuestionKind } from "./meriAnswer";
import { fetchDietPlaces } from "./dietPlaces";
import { bestMonthsFromClimate, fetchMonthlyClimate, type MonthClimate } from "./monthlyClimate";
import { searchPlaces } from "./placeSearch";
import { googlePlacesMemo } from "./fetchCache";
import { getCandidatePois } from "./pois";
import { fetchDietaryVenues } from "./dietaryVenues";
import type { ReadyTrip } from "./readyTrips";
import { braveWebResults, type BraveResult } from "./destinationFestivals";

type Point = { lat: number; lng: number };

/** The fetchers `gatherEvidence` uses, so a test can hand it fakes and never touch the network. */
export interface EvidenceDeps {
  climate: (point: Point) => Promise<MonthClimate[] | null>;
  dietPlaces: (point: Point, diet: string | null) => Promise<EvidencePlace[] | null>;
  /** `provider` names the source id the places carry. */
  nearby: (point: Point) => Promise<{ provider: "google" | "osm"; places: EvidencePlace[] } | null>;
  pois: (point: Point) => Promise<EvidencePlace[] | null>;
  venues: (point: Point, diet: string) => Promise<EvidencePlace[] | null>;
  /** Web pages about eating there (Brave search): read and cited, never turned into places. */
  pages: (query: string) => Promise<BraveResult[] | null>;
}

/** How many web pages a food answer may cite. Few, so the model reads them rather than skims. */
const FOOD_PAGES = 4;

const SOURCE_LABELS: Record<string, string> = {
  osm: "OpenStreetMap",
  google: "Google Places",
  opentripmap: "OpenTripMap",
  yelp: "Yelp",
  climate: "Open-Meteo weather history",
};

/**
 * Each provider's public home page, fixed here. A provider's own per-place URL is never used: it is
 * outside data, and a link is the one thing in an answer a traveller acts on without reading.
 * The ready-made trip, the plan and the forecast are TripMate's own, so they carry no link.
 */
export const SOURCE_URLS: Record<string, string> = {
  osm: "https://www.openstreetmap.org",
  climate: "https://open-meteo.com",
  opentripmap: "https://opentripmap.io",
  yelp: "https://www.yelp.com",
  google: "https://maps.google.com",
};

const source = (id: string): EvidenceSource => ({ id, label: SOURCE_LABELS[id] ?? id, ...(SOURCE_URLS[id] ? { url: SOURCE_URLS[id] } : {}) });

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const realDeps: EvidenceDeps = {
  climate: fetchMonthlyClimate,
  dietPlaces: fetchDietPlaces,
  nearby: async (point) => {
    const found = await searchPlaces({ ...point, categories: ["sights", "park"], radiusM: 3000 }, googlePlacesMemo);
    if (!found.available) return null;
    return {
      provider: found.provider,
      places: found.places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, ...(p.address ? { detail: p.address } : {}), sourceId: found.provider })),
    };
  },
  pois: async (point) => {
    const pois = await getCandidatePois(point.lat, point.lng);
    return pois && pois.map((p, i) => ({ id: `otm${i}`, name: p.name, lat: p.lat, lng: p.lon, ...(p.category ? { detail: p.category.replace(/_/g, " ") } : {}), sourceId: "opentripmap" }));
  },
  // Yelp's answer carries no coordinates (dietaryVenues.ts drops them), so these sit at the search
  // point: right for "near here", not a pin on the venue.
  venues: async (point, diet) => {
    const venues = await fetchDietaryVenues({ lat: point.lat, lon: point.lng }, { tags: [diet], note: "" });
    return venues && venues.map((v, i) => ({ id: `yelp${i}`, name: v.name, lat: point.lat, lng: point.lng, ...(v.rating !== null ? { detail: `${v.rating}★` } : {}), sourceId: "yelp" }));
  },
  pages: (query) => braveWebResults(query, FOOD_PAGES),
};

/**
 * One web page as a source and the fact it states. **The exception to `SOURCE_URLS`, and why:** a
 * page *is* its URL, so citing one means linking it. What keeps it safe is that the link comes
 * from Brave's result record, never from the model's prose, exactly like every other source; only
 * https pages are kept. The fact says it is a page's claim, so the answer can say "these pages list
 * …" rather than vouch for a restaurant nothing here checked.
 */
function pageEvidence(results: BraveResult[]): { source: EvidenceSource; fact: Evidence["facts"][number] }[] {
  const out: { source: EvidenceSource; fact: Evidence["facts"][number] }[] = [];
  for (const r of results) {
    const title = r.title?.replace(/<[^>]+>/g, "").trim();
    const text = r.description?.replace(/<[^>]+>/g, "").trim();
    let host: string;
    try {
      const url = new URL(r.url ?? "");
      if (url.protocol !== "https:") continue;
      host = url.hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (!title || !text) continue;
    const id = `web${out.length + 1}`;
    // The label is a tag under the answer, so a 70-character headline is cut to fit one.
    const short = title.length > 40 ? `${title.slice(0, 39).trimEnd()}…` : title;
    out.push({ source: { id, label: `${short} (${host})`, url: r.url! }, fact: { text: `A web page on ${host} says: ${title}. ${text}`, sourceId: id } });
  }
  return out;
}

/**
 * The facts Meri may answer a question from. Never throws: a source that fails is left out, so the
 * answer is built from what was actually checked. `entry` and `other` fetch nothing: entry rules
 * are a fixed line and anything else has nothing to be grounded in.
 */
export async function gatherEvidence(
  input: {
    kind: QuestionKind;
    point: Point;
    place: string;
    diet: string | null;
    readyTrip: ReadyTrip | null;
    extraSources?: EvidenceSource[];
    extraPlaces?: EvidencePlace[];
    /** The trip's destination, added to the web query when `place` is a stop's bare name: "halal
     *  restaurants near Petra" also finds a Petra Halal Food in Virginia. */
    region?: string;
  },
  deps: EvidenceDeps = realDeps
): Promise<Evidence> {
  const { kind, point, diet, readyTrip } = input;
  const used = new Set<string>();
  const sources: EvidenceSource[] = [...(input.extraSources ?? [])];
  const facts: Evidence["facts"] = [];
  const months = new Set<number>();
  const found: EvidencePlace[] = [...(input.extraPlaces ?? [])];
  // A failing fetcher is the same as one with nothing to say.
  const attempt = async <T>(run: () => Promise<T | null>): Promise<T | null> => {
    try {
      return await run();
    } catch {
      return null;
    }
  };

  if (kind === "best_time") {
    if (readyTrip && readyTrip.bestMonths.length) {
      // Worded as TripMate's suggestion, not "our trip is set for": the model once read that as the
      // traveller's own booking and answered "your trip is scheduled for March through May".
      sources.push({ id: "trip", label: `TripMate's ready-made ${readyTrip.title} trip` });
      facts.push({
        text: `TripMate's ready-made ${readyTrip.title} trip suggests going in ${readyTrip.bestMonths.map((m) => MONTH_NAMES[m - 1]).join(", ")}; it is a suggestion, not the traveller's own trip.`,
        sourceId: "trip",
      });
      readyTrip.bestMonths.forEach((m) => months.add(m));
    }
    const climate = await attempt(() => deps.climate(point));
    if (climate?.length) {
      sources.push(source("climate"));
      // Every month stays a fact, but only the good ones may be named: a 40°C July is covered by the
      // data and is still not an answer to "when should I go".
      for (const c of climate) {
        facts.push({ text: `${MONTH_NAMES[c.month - 1]}: ${c.highC}°C average high, ${c.rainDays} rain days`, sourceId: "climate" });
      }
      const best = bestMonthsFromClimate(climate);
      best.forEach((m) => months.add(m));
      if (best.length) facts.push({ text: `Mildest and driest months: ${best.map((m) => MONTH_NAMES[m - 1]).join(", ")}.`, sourceId: "climate" });
    }
  } else if (kind === "see") {
    const nearby = await attempt(() => deps.nearby(point));
    if (nearby) found.push(...nearby.places);
    const pois = await attempt(() => deps.pois(point));
    if (pois) found.push(...pois);
  } else if (kind === "food") {
    const places = await attempt(() => deps.dietPlaces(point, diet));
    if (places) found.push(...places);
    // Yelp is searched by diet, so with none stated there is nothing to ask it.
    const venues = diet ? await attempt(() => deps.venues(point, diet)) : null;
    if (venues) found.push(...venues);
    // OSM's diet tags are sparse (0 halal places within 3 km of central Jaipur), so the pages are
    // usually what a food answer stands on.
    const where = input.region && !input.place.toLowerCase().includes(input.region.toLowerCase()) ? `${input.place}, ${input.region}` : input.place;
    const pages = await attempt(() => deps.pages(`${diet ? `${diet} ` : ""}restaurants near ${where}`));
    for (const { source: s, fact } of pageEvidence(pages ?? [])) {
      sources.push(s);
      facts.push(fact);
    }
  }

  const seen = new Set<string>();
  const places: EvidencePlace[] = [];
  for (const p of found) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({ ...p, id: `p${places.length + 1}` });
    used.add(p.sourceId);
  }
  for (const id of used) {
    if (!sources.some((s) => s.id === id)) sources.push(source(id));
  }

  return { sources, places, months: [...months].sort((a, b) => a - b), facts };
}
