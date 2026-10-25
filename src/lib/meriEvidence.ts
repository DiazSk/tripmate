import type { Evidence, EvidencePlace, EvidenceSource, QuestionKind } from "./meriAnswer";
import { fetchDietPlaces } from "./dietPlaces";
import { bestMonthsFromClimate, fetchMonthlyClimate, type MonthClimate } from "./monthlyClimate";
import { searchPlaces } from "./placeSearch";
import { googlePlacesMemo } from "./fetchCache";
import { getCandidatePois } from "./pois";
import { fetchDietaryVenues } from "./dietaryVenues";
import type { ReadyTrip } from "./readyTrips";

type Point = { lat: number; lng: number };

/** The fetchers `gatherEvidence` uses, so a test can hand it fakes and never touch the network. */
export interface EvidenceDeps {
  climate: (point: Point) => Promise<MonthClimate[] | null>;
  dietPlaces: (point: Point, diet: string | null) => Promise<EvidencePlace[] | null>;
  /** `provider` names the source id the places carry. */
  nearby: (point: Point) => Promise<{ provider: "google" | "osm"; places: EvidencePlace[] } | null>;
  pois: (point: Point) => Promise<EvidencePlace[] | null>;
  venues: (point: Point, diet: string) => Promise<EvidencePlace[] | null>;
}

const SOURCE_LABELS: Record<string, string> = {
  osm: "OpenStreetMap",
  google: "Google Places",
  opentripmap: "OpenTripMap",
  yelp: "Yelp",
  climate: "Open-Meteo weather history",
};

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
};

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
      sources.push({ id: "trip", label: `Our ${readyTrip.title} trip` });
      facts.push({ text: `Our ${readyTrip.title} trip is set for ${readyTrip.bestMonths.map((m) => MONTH_NAMES[m - 1]).join(", ")}.`, sourceId: "trip" });
      readyTrip.bestMonths.forEach((m) => months.add(m));
    }
    const climate = await attempt(() => deps.climate(point));
    if (climate?.length) {
      sources.push({ id: "climate", label: SOURCE_LABELS.climate });
      for (const c of climate) {
        months.add(c.month);
        facts.push({ text: `${MONTH_NAMES[c.month - 1]}: ${c.highC}°C average high, ${c.rainDays} rain days`, sourceId: "climate" });
      }
      const best = bestMonthsFromClimate(climate);
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
    if (!sources.some((s) => s.id === id)) sources.push({ id, label: SOURCE_LABELS[id] ?? id });
  }

  return { sources, places, months: [...months].sort((a, b) => a - b), facts };
}
