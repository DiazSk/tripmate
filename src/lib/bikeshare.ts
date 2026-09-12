import { TTL, cached } from "./fetchCache";
import { haversineKm } from "./travelTime";

/**
 * Does this destination have a public bikeshare, and what does it cost?
 *
 * **This fills a gap the codebase has carried an apology for since the staged pipeline shipped.**
 * `RawFetch.transportModes` was documented as a permanent `available: false` ("no reliable free
 * data source exists for this yet"), and `probeTransitAvailable` (`osrmRoute.ts`) still returns a
 * flat `false` because nothing publishes the transit equivalent of dock coordinates, so
 * `reconcile.ts` has always fallen through to assuming walk + transit — i.e. every plan this app
 * has ever produced assumed a metro exists. GBFS is a real, free, keyless source for the bike half
 * of that question.
 *
 * **Why the static half only.** GBFS publishes `station_status.json` (how many bikes are docked
 * right this second) alongside `station_information.json` (where the docks are) and
 * `system_pricing_plans.json` (what it costs). This module reads the second and third and
 * deliberately never the first: a trip is planned weeks or months out, so live dock counts are
 * false by the time anyone travels. That distinction is the whole reason this source was worth
 * adopting when a dozen sibling live-data feeds were not.
 *
 * Fails soft, per the house convention (see `holidays.ts`, `dietaryVenues.ts`): `null` means "we
 * could not answer", which the caller must render as *unknown*, never as "this city has no
 * bikeshare". The two are different claims and only one of them is safe to make.
 */
export interface BikeshareSystem {
  /** The public brand, e.g. "Vélib' Metropole". See the note at the return site for why this
   *  prefers the catalog's column over the system's own `system_information.json`. */
  name: string;
  systemId: string;
  /** Docks within `NEARBY_RADIUS_KM` of the destination. Carried so the prompt can say "about 300
   *  docking stations" rather than a bare yes, which reads very differently for a 12-dock town. */
  stationsNearby: number;
  /** `null` whenever a day pass could not be read *honestly* — which is the common case. See
   *  `readDayPass` for why that bar is set deliberately high. */
  dayPass: { amount: number; currency: string } | null;
}

/** One row of MobilityData's catalog, reduced to the four columns this module uses. */
export interface SystemRow {
  name: string;
  countryCode: string;
  location: string;
  systemId: string;
  autoDiscoveryUrl: string;
  authType: string;
}

/**
 * Wall-clock cap per outbound call. Same reasoning as `holidays.ts`: without a signal a hung
 * upstream sits for ~5 minutes and takes the generation request with it, and an abort throws,
 * which is the same shape as any other failure here and lands on the fail-soft path already.
 *
 * 20s, not the 10s the other clients use, because a `station_information.json` is not a small
 * JSON: BIXI's is 1,112 stations, Citi Bike's 2,507. At 10s BIXI intermittently aborted, and the
 * failure was not visible as a failure — Montréal silently resolved to `PBSC HQ`, the *vendor's
 * head office* and its three demo docks, because that was the next candidate standing. A timeout
 * here does not surface as an error, it surfaces as a worse answer.
 */
const BIKESHARE_TIMEOUT_MS = 20_000;

/** The canonical catalog of GBFS systems. Keyless and CORS-open; this is fetched server-side. */
const CATALOG_URL = "https://raw.githubusercontent.com/MobilityData/gbfs/master/systems.csv";

/**
 * How far from the destination a dock still counts as serving it.
 *
 * The destination coordinate is a city centroid from Open-Meteo, and a bikeshare spreads across a
 * metro area, so a tight radius rejects real systems whose docks cluster off-centre. 15km is
 * generous on purpose; `MIN_NEARBY_STATIONS` is what stops that generosity turning into a false
 * positive, since a single stray dock 14km out should not qualify a city.
 */
const NEARBY_RADIUS_KM = 15;
/**
 * Below this, a feed is not a system a traveler can plan a day around.
 *
 * Raised from 3 after Montréal resolved to `PBSC HQ` — the bike *vendor's* head office, publishing
 * nine stations of which three are near the city. There is no generic way to recognise a vendor
 * demo feed, so the dock count is the honest proxy. 5 is placed against measured systems rather
 * than chosen roundly: it drops PBSC HQ's 3 and keeps every real system checked, the smallest
 * being KVV.nextbike's 8 in Karlsruhe and Donkey Republic Amsterdam's 27.
 */
const MIN_NEARBY_STATIONS = 5;

/**
 * Cap on how many name-matched systems get verified over the network.
 *
 * The cap exists so a loose match cannot fan out — France alone has 273 systems in the catalog, so
 * an unbounded walk over a country is not an option. But it was 5, and measured against real
 * cities that truncates: Paris produces **8** candidates and Washington 7, because every scooter
 * operator registers a row per city. Vélib' and Capital Bikeshare survived a cap of 5 only by
 * where they happened to fall in catalog order, which is not a property to rely on.
 *
 * 10 covers the measured maximum with headroom. The extra candidates are cheap: each step is
 * cached separately under `TTL.STATIC`, so a city pays this walk once.
 */
const MAX_CANDIDATES = 10;

// --- The pure core ---------------------------------------------------------------------------
// Everything below this line up to `fetchBikeshare` is deterministic and exported for
// `bikeshare.test.mjs`, because `npm test` reaches no network and a parser nothing tests is a
// parser that breaks silently. The fixtures in that file are real payload shapes measured against
// live feeds, not idealised ones — see `readDayPass` for why that distinction matters here.

/**
 * Minimal CSV reader for the catalog's 10-column file.
 *
 * Deliberately not a dependency: this parses one known file with one known dialect, and a
 * `csv-parse` in `package.json` would be a permanent cost for a transient need. It does handle
 * quoted fields containing commas, which the catalog genuinely has ("Washington, DC").
 *
 * A row that does not have enough columns is dropped rather than throwing — a malformed catalog
 * must degrade to "fewer systems known", never to a failed itinerary generation.
 */
export function parseSystemsCsv(text: string): SystemRow[] {
  const rows = splitCsvRows(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const col = (want: string) => header.findIndex((h) => h.toLowerCase() === want.toLowerCase());
  const iCountry = col("Country Code");
  const iName = col("Name");
  const iLocation = col("Location");
  const iSystemId = col("System ID");
  const iUrl = col("Auto-Discovery URL");
  const iAuth = col("Authentication Type");

  // Without these four there is nothing to match or fetch, so an unrecognised header shape is
  // "no systems known" rather than a crash.
  if (iCountry < 0 || iLocation < 0 || iUrl < 0 || iSystemId < 0) return [];

  const out: SystemRow[] = [];
  for (const cells of rows.slice(1)) {
    const url = (cells[iUrl] ?? "").trim();
    const location = (cells[iLocation] ?? "").trim();
    const countryCode = (cells[iCountry] ?? "").trim();
    if (!url || !location || !countryCode) continue;
    out.push({
      name: (iName >= 0 ? cells[iName] : "")?.trim() ?? "",
      countryCode,
      location,
      systemId: (cells[iSystemId] ?? "").trim(),
      autoDiscoveryUrl: url,
      authType: (iAuth >= 0 ? cells[iAuth] : "")?.trim() ?? "",
    });
  }
  return out;
}

/** Character-level scan, because a `split(",")` corrupts every quoted field with a comma in it —
 *  and the catalog's `Location` column is exactly where those live. */
function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      // A CRLF must not emit an empty row between the two characters.
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Lowercase, strip diacritics, strip punctuation, collapse whitespace. `"Zürich"` and `"Malmö"`
 *  have to compare equal to the geocoder's spelling, and the catalog and Open-Meteo do not agree
 *  on accents. NFD splits a letter from its combining mark so the mark can be removed. */
export function normalizeLocation(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Catalog rows plausibly serving this city, best guess first.
 *
 * Country code is an exact filter and does the heavy lifting — it alone removes the "Cambridge,
 * Massachusetts vs Cambridge, England" class of error entirely. The name comparison is then only
 * resolving *within* one country, which is a much easier problem.
 *
 * Exact matches sort ahead of partial ones, so "York" prefers a York system over New York's. This
 * is a ranking, not a decision: `fetchBikeshare` still proves every candidate against real station
 * coordinates before believing any of them.
 *
 * **A `Location` naming a country rather than a city is a known miss, and widening this to catch
 * them was tried and reverted.** Measured miss rate over twelve verification destinations: one.
 * That one is Zürich, which no amount of matching fixes:
 *
 * - Its own brand, PubliBike, publishes a `station_information.json` containing **zero** stations.
 * - The feed that does carry Zürich's 477 physical docks is `sharedmobility.ch`, a national
 *   aggregator whose catalog `Location` is "Switzerland" — so a country-name tier does reach it —
 *   but its station feed is 13,147 stations and **the server closes the socket after ~1.6s**,
 *   identically at a 30s and a 90s timeout. It is not slow, it is unfetchable.
 * - Meanwhile that tier actively hurts: Switzerland's country-named rows are `2EM Car Sharing`,
 *   `edrive carsharing`, `Mobility` and `carvelo`, which took four of the eight candidate slots
 *   and crowded out city systems, spending fetches on car fleets before `hasBicycleForm` can run.
 *
 * So the tier cost real candidate slots and fixed nothing. Don't re-add it without first checking
 * whether that aggregator feed has become fetchable.
 *
 * Florence is not a miss at all, though it looks like one: brute-forcing **every** Italian system
 * by real proximity finds no capacity-bearing dock within 15km of the city. `null` there is the
 * correct answer, and its bikeshare simply is not in this catalog.
 *
 * ponytail: name matching, first-match-wins. Misses are safe (they read as "no bikeshare") but
 * invisible. If coverage disappoints across many more cities, the upgrade is a build-time centroid
 * index making presence a pure haversine lookup with no names involved.
 */
export function matchCandidates(
  rows: SystemRow[],
  geo: { name: string; countryCode: string | null }
): SystemRow[] {
  if (!geo.countryCode) return [];
  const city = normalizeLocation(geo.name);
  if (!city) return [];
  const country = geo.countryCode.toUpperCase();

  const scored: { row: SystemRow; score: number }[] = [];
  for (const row of rows) {
    if (row.countryCode.toUpperCase() !== country) continue;
    // A feed behind a key is out of scope; silently skipping matches how every other client here
    // treats a missing credential (`dietaryVenues.ts`: `if (!apiKey) return null`).
    if (row.authType && row.authType.toLowerCase() !== "none") continue;

    const loc = normalizeLocation(row.location);
    if (!loc) continue;
    if (loc === city) scored.push({ row, score: 2 });
    else if (containsWord(loc, city) || containsWord(city, loc)) scored.push({ row, score: 1 });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map((s) => s.row);
}

/** Whole-token containment, so "york" does not match inside "yorkshire". Both sides are already
 *  normalized to single-spaced lowercase, so a space-padded `includes` is the whole test. */
function containsWord(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Docking stations within `radiusKm` of the destination.
 *
 * **`capacity > 0` is the filter, and it is what separates a bikeshare from a scooter fleet.**
 * GBFS is published by free-floating operators too, and their `station_information.json` lists
 * parking *zones* rather than docks. Measured across live feeds, the split is total:
 *
 * | System | stations | with `capacity` |
 * |---|---|---|
 * | Citi Bike | 2507 | 2477 |
 * | BIXI Montréal | 1112 | 1109 |
 * | Capital Bikeshare | 866 | 866 |
 * | Bicing | 544 | 542 |
 * | **Dott Paris** | **13206** | **0** |
 * | **Bird Barcelona** | **3590** | **0** |
 *
 * Real docked systems populate it on ~100% of stations; free-floating operators omit the field
 * entirely on 100% of them. Without this filter Paris resolved to Dott's 13,206 scooter zones
 * instead of Vélib', and Barcelona to Bird — both measured, both wrong, and both wrong in the
 * worst way, since the count looked *more* authoritative for being larger.
 *
 * The count rather than a boolean, because "3 docks" and "900 docks" are different facts about a
 * city and the prompt passes on which.
 */
export function countStationsWithin(
  stations: Station[],
  point: { lat: number; lon: number },
  radiusKm: number
): number {
  return stations.filter((s) => s.capacity > 0 && haversineKm(point, s) <= radiusKm).length;
}

/**
 * Nearby stations that are *physical* docks — capacity, and not a virtual bay.
 *
 * **This is how the right system gets picked in a city with several.** Ranking by raw station
 * count looked obvious and was wrong, measured: in Paris, Vélib' publishes 1,519 stations with
 * `is_virtual_station: 0` and capacities of 21-60, while Voi publishes **13,065**, every one
 * virtual, with capacities of 1-8. Voi is a scooter operator whose "stations" are painted parking
 * bays. Sorting on the bigger number handed Paris to Voi, and it did so with an authoritative-
 * looking dock count.
 *
 * A zero here is not disqualifying, only weaker. Hub-based bikeshares are genuinely all-virtual —
 * Donkey Republic Amsterdam is 31 virtual hubs and is a real, usable bikeshare — so this ranks
 * rather than filters, and a city whose only operator is hub-based still resolves to it.
 */
export function countPhysicalDocksWithin(
  stations: Station[],
  point: { lat: number; lon: number },
  radiusKm: number
): number {
  return stations.filter(
    (s) => s.capacity > 0 && !s.virtual && haversineKm(point, s) <= radiusKm
  ).length;
}

export interface Station {
  lat: number;
  lon: number;
  capacity: number;
  virtual: boolean;
}

/** `station_information.json` → coordinates, dock count and whether the dock is physical,
 *  tolerating both GBFS versions and junk. A missing or unparseable `capacity` becomes 0, which
 *  `countStationsWithin` reads as "not a dock" — the conservative direction, since the alternative
 *  is counting a scooter parking zone as a bike dock. */
export function readStations(payload: unknown): Station[] {
  const list = asArray(pick(pick(payload, "data"), "stations"));
  const out: Station[] = [];
  for (const s of list) {
    const lat = Number(pick(s, "lat"));
    const lon = Number(pick(s, "lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const capacity = Number(pick(s, "capacity"));
    out.push({
      lat,
      lon,
      capacity: Number.isFinite(capacity) ? capacity : 0,
      virtual: pick(s, "is_virtual_station") === true,
    });
  }
  return out;
}

/**
 * Is this actually a *bike* share?
 *
 * **The single most important guard in this module.** MobilityData's catalog is no longer
 * bikes-only — it now lists general shared-mobility systems, car-shares included. Measured against
 * live feeds: `Stadtmobil Karlsruhe` reports `form_factors: ["car"]`, and `TeilAuto Biberach`
 * publishes plans named "Kleinwagen — 24 Stunden" (a compact car for 24 hours). Without this check
 * a name-and-proximity match would confidently tell a traveller that Karlsruhe has bikeshare and
 * quote them a car rental price.
 *
 * **Absence is not disqualifying.** `vehicle_types.json` is an optional feed — `Velo Antwerpen`
 * publishes only `station_information`, `station_status` and `system_information` and is a genuine
 * bikeshare. So the rule is asymmetric on purpose: an explicit non-bike claim rejects, silence
 * does not. Mixed fleets qualify on the bicycle (`Bicing` returns bicycle + scooter_standing).
 */
export function hasBicycleForm(payload: unknown): boolean {
  const types = asArray(pick(pick(payload, "data"), "vehicle_types"));
  if (types.length === 0) return true;
  return types.some((t) => pick(t, "form_factor") === "bicycle");
}

/** Names that mean a flat pass for a day. */
const DAY_PASS_RE = /\b(day\s*pass|daily\s*pass|day\s*ticket|24[\s-]*hour|1[\s-]*day|one[\s-]*day)\b/i;
/** Names that prove a plan is metered or recurring, whatever else they also say. */
const NOT_FLAT_RE = /(\/\s*min|per\s*min|\/\s*hour|per\s*hour|\bmonth|\bannual|\byear|\bmember|\bsubscri)/i;

/**
 * A day pass, but only when the feed states one unambiguously.
 *
 * **This refuses far more often than it accepts, and that is the design.** `system_pricing_plans.json`
 * is far looser in practice than the spec reads. Measured against live feeds:
 *
 * - `nextbike Zlín` — plan *name* is `"CZK 2/min, max. CZK 500/24h"`, with `price: 0`
 * - `Grad Križevci` — `"<30min EUR 0, EUR 0.66 (HRK 5) / 30 min"`, `price: 0`
 * - `PubliBike` — names are just `"Bike pricing"` / `"Ebike pricing"`, `price: 0`
 * - `Capital Bike Share` — `"EBIKE SINGLE RIDE"`, `price: "1.00"` — a **string**, not a number
 *
 * Two rules follow. **A `price` of 0 means "not stated", not "free"** — a free-bikeshare claim in a
 * budget figure would be a confident falsehood, and these feeds are full of zeroes. **And a price
 * is never parsed out of the plan name**, which is free text in the operator's own language:
 * `"CZK 2/min, max. CZK 500/24h"` is not a day pass, and guessing which number to lift is exactly
 * how a wrong figure reaches `BudgetBar`.
 *
 * So: an unambiguous day-pass name, a positive price, and an explicit currency, or `null`.
 *
 * **Expect `null` almost always, and do not loosen this when you notice.** Checked against the six
 * systems this module resolves for the largest destinations: Vélib' Paris and BIXI Montréal publish
 * **no pricing feed at all**; Citi Bike and Capital Bikeshare each publish exactly one plan — an
 * `"EBIKE SINGLE RIDE"` per-minute rate — despite both selling a day pass at the kiosk; Vélibéo
 * prices everything at 0. And Bicing, for a Barcelona system charging euros, tags its fares
 * **`"CLP"` — Chilean pesos**. That last one is the argument for this whole function: a lenient
 * reader would have quoted a traveller a Barcelona day pass in the wrong currency, which is a worse
 * failure than saying nothing. Presence and dock density are what this source reliably delivers;
 * the fare is a bonus that usually is not there.
 */
export function readDayPass(payload: unknown): { amount: number; currency: string } | null {
  const plans = asArray(pick(pick(payload, "data"), "plans"));
  for (const plan of plans) {
    const name = readLocalized(pick(plan, "name"));
    if (!name || !DAY_PASS_RE.test(name) || NOT_FLAT_RE.test(name)) continue;
    // `per_min_pricing`/`per_km_pricing` being populated is the feed itself saying the headline
    // price is not the whole story, whatever the plan is called.
    if (asArray(pick(plan, "per_min_pricing")).length > 0) continue;
    if (asArray(pick(plan, "per_km_pricing")).length > 0) continue;

    const amount = Number(pick(plan, "price"));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const currency = pick(plan, "currency");
    if (typeof currency !== "string" || currency.trim() === "") continue;

    return { amount, currency: currency.trim().toUpperCase() };
  }
  return null;
}

/** GBFS v2 keys `name` by language (`[{language, text}]` or `{en: …}`); v3 uses a plain string.
 *  Reading only one shape would silently skip every system on the other version. */
function readLocalized(value: unknown): string {
  if (typeof value === "string") return value;
  const arr = asArray(value);
  for (const entry of arr) {
    const text = pick(entry, "text");
    if (typeof text === "string" && text) return text;
  }
  return "";
}

/** `gbfs.json` → a feed-name-to-URL map. v3 puts `feeds` directly under `data`; v2 nests it under
 *  a language key, and which key that is varies by operator, so the first one wins. */
export function readFeedUrls(payload: unknown): Record<string, string> {
  const data = pick(payload, "data");
  let feeds = asArray(pick(data, "feeds"));
  if (feeds.length === 0 && data && typeof data === "object") {
    for (const value of Object.values(data as Record<string, unknown>)) {
      const nested = asArray(pick(value, "feeds"));
      if (nested.length > 0) {
        feeds = nested;
        break;
      }
    }
  }
  const out: Record<string, string> = {};
  for (const feed of feeds) {
    const name = pick(feed, "name");
    const url = pick(feed, "url");
    if (typeof name === "string" && typeof url === "string") out[name] = url;
  }
  return out;
}

const pick = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// --- The network path ------------------------------------------------------------------------

/**
 * Resolve a destination to its bikeshare system, or `null`.
 *
 * Every step is cached separately (`TTL.STATIC` — dock locations and fares move on the scale of
 * years), so a cold walk that rejects four candidates before finding the fifth does not re-pay for
 * those four next time.
 *
 * **Proximity is what makes this safe.** A name match alone can land on a system in another city
 * entirely; nothing is believed until its own published station coordinates put at least
 * `MIN_NEARBY_STATIONS` docks within `NEARBY_RADIUS_KM` of the destination. Candidates are then
 * ranked by that count rather than by catalog order, so a multi-system city (New York has Citi
 * Bike plus smaller neighbours) resolves to the one that actually serves it.
 */
export async function fetchBikeshare(geo: {
  lat: number;
  lon: number;
  name: string;
  countryCode: string | null;
}): Promise<BikeshareSystem | null> {
  try {
    const catalog = await cached("gbfs:catalog", TTL.STATIC, fetchCatalog);
    if (!catalog) return null;

    const candidates = matchCandidates(catalog, geo);
    if (candidates.length === 0) return null;

    // Verify every candidate before choosing, so the winner is the system with the most docks here
    // rather than whichever the catalog happened to list first.
    const verified: {
      row: SystemRow;
      feeds: Record<string, string>;
      stationsNearby: number;
      physicalDocks: number;
    }[] = [];
    for (const row of candidates) {
      const feeds = await cached(`gbfs:feeds:${row.systemId}`, TTL.STATIC, () =>
        fetchJson(row.autoDiscoveryUrl).then((p) => (p ? readFeedUrls(p) : null))
      );
      if (!feeds?.station_information) continue;

      const stations = await cached(`gbfs:stations:${row.systemId}`, TTL.STATIC, () =>
        fetchJson(feeds.station_information).then((p) => (p ? readStations(p) : null))
      );
      if (!stations) continue;

      const stationsNearby = countStationsWithin(stations, geo, NEARBY_RADIUS_KM);
      if (stationsNearby < MIN_NEARBY_STATIONS) continue;
      verified.push({
        row,
        feeds,
        stationsNearby,
        physicalDocks: countPhysicalDocksWithin(stations, geo, NEARBY_RADIUS_KM),
      });
    }

    // Physical docks first, then size. See `countPhysicalDocksWithin` for the measurement that
    // made this ordering necessary — on raw count alone, Paris resolved to a scooter fleet.
    verified.sort((a, b) => b.physicalDocks - a.physicalDocks || b.stationsNearby - a.stationsNearby);

    for (const { row, feeds, stationsNearby } of verified) {
      // The car-share guard, paid only on candidates that already cleared proximity.
      if (feeds.vehicle_types) {
        const vehicles = await cached(`gbfs:vehicles:${row.systemId}`, TTL.STATIC, () =>
          fetchJson(feeds.vehicle_types)
        );
        if (vehicles && !hasBicycleForm(vehicles)) continue;
      }

      const info = feeds.system_information
        ? await cached(`gbfs:info:${row.systemId}`, TTL.STATIC, () =>
            fetchJson(feeds.system_information)
          )
        : null;
      const pricing = feeds.system_pricing_plans
        ? await cached(`gbfs:pricing:${row.systemId}`, TTL.STATIC, () =>
            fetchJson(feeds.system_pricing_plans)
          )
        : null;

      return {
        // Catalog name first, `system_information` second — the opposite of what it seems like it
        // should be, and measured: `system_information.name` is often an internal label, giving
        // "Paris" for Vélib' Metropole, "Bike Barcelona" for Bicing and "Bixi_MTL" for BIXI
        // Montréal. The catalog's column carries the public brand a traveller would recognise.
        name: row.name || readLocalized(pick(pick(info, "data"), "name")) || row.location,
        systemId: row.systemId,
        stationsNearby,
        dayPass: pricing ? readDayPass(pricing) : null,
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchCatalog(): Promise<SystemRow[] | null> {
  try {
    const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(BIKESHARE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const rows = parseSystemsCsv(await res.text());
    // An empty parse is a parse failure, not a world with no bikeshare in it. Returning `null`
    // also stops `cached()` freezing the emptiness for 90 days — it never writes a null.
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(BIKESHARE_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
