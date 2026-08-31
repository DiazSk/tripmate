import { closedDaysFromOpeningHours } from "../poiDetails";
import { reconcileTrip } from "../reconcile";
import { buildTravelLegs } from "../travelTime";
import { estimateVisitMinutes } from "../visitDuration";
import { BASE_ITINERARIES } from "./baseItineraries";
import type { CandidatePoi } from "../pois";
import type { Holiday } from "../holidays";
import type { DayWeather } from "../weather";
import type {
  DateContext,
  EnrichedPoi,
  Itinerary,
  PoiDetails,
  RawFetch,
  ReconciledTrip,
  TransportMode,
  UserAnswers,
} from "../types";

/**
 * The frozen test set: sample trips the benchmark runs every model against.
 *
 * Everything here is a literal — including `leadTimeDays`, the weather rows and the holiday list —
 * so a run in October produces the same trip-context bytes as a run in August. `buildDateContext`
 * and the real fetchers are deliberately NOT called: they read the clock and the network, and a
 * benchmark whose input drifts between runs can't attribute a score difference to the model.
 *
 * What *is* real: `reconcileTrip` derives the resolved flags and provenance notes, and
 * `buildTravelLegs` / `estimateVisitMinutes` / `closedDaysFromOpeningHours` produce the POI detail
 * bundle. Those are the same functions the pipeline runs, so a fixture can't drift away from what
 * the app would actually hand the model.
 *
 * Interest tags use the app's real `INTEREST_TAGS` strings ("Culture & History", not "history"),
 * because that is what the picker — and the benchmark's own trip form — actually emits.
 *
 * The set covers, deliberately: all three group types, the full pace range (slow through fast),
 * anchors-present vs. plan-from-profile-only, both hemispheres, and the three degraded paths that
 * `reconcile.ts` has rules for (estimated/absent weather, absent holidays, absent transport data).
 */

export interface BenchFixture {
  id: string;
  title: string;
  /** One line on what this fixture is for — shown in the UI next to its results. */
  covers: string;
  reconciled: ReconciledTrip;
  poiDetails: PoiDetails;
  /** Frozen starting plan for refine cells, minted once by scripts/mint-base-itineraries.mjs and
   *  committed. Every model refines the byte-identical plan, so only `model` varies — the same
   *  claim the generation cells make about the trip-context bytes. Absent = generation-only. */
  baseItinerary?: Itinerary;
}

// --- compact literal builders ------------------------------------------------------------------

function weather(
  date: string,
  tempMinC: number,
  tempMaxC: number,
  precipitationProbability: number | null,
  sunrise: string | null,
  sunset: string | null,
  historical = false
): DayWeather {
  return {
    date,
    tempMinC,
    tempMaxC,
    precipitationProbability,
    humidity: null,
    weatherCode: null,
    sunrise: sunrise ? `${date}T${sunrise}` : null,
    sunset: sunset ? `${date}T${sunset}` : null,
    historical,
  };
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Frozen date context. `leadTimeDays` is a literal, not `Date.now()` arithmetic. */
function dates(startDate: string, tripDays: number, leadTimeDays: number, season: DateContext["season"]): DateContext {
  const days = Array.from({ length: tripDays }, (_, i) => {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    return { date: iso, dayOfWeek: WEEKDAY[d.getUTCDay()] };
  });
  return { tripDays, leadTimeDays, season, days };
}

interface PoiSpec {
  name: string;
  lat: number;
  lon: number;
  kinds: string | null;
  openingHours: string | null;
  /** OSM `wheelchair`, as `fetchPoiOsmTags` now returns it. Omit for "no tag on record", which is
   *  the common case and is NOT the same as `"no"`. */
  wheelchair?: "yes" | "limited" | "no";
}

function candidate(p: PoiSpec): CandidatePoi {
  return { name: p.name, lat: p.lat, lon: p.lon, category: p.kinds };
}

interface FixtureSpec {
  id: string;
  title: string;
  covers: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
  countryCode: string;
  startDate: string;
  tripDays: number;
  leadTimeDays: number;
  season: DateContext["season"];
  weatherDays: DayWeather[] | null;
  weatherHistorical?: boolean;
  holidays: Holiday[] | null;
  transportModes: TransportMode[] | null;
  /** Everything the fetch surfaced. Grounding scores against this set. */
  candidates: PoiSpec[];
  /** The subset the traveler pinned as anchors — indices into `candidates`. */
  anchorIndexes: number[];
  answers: Omit<UserAnswers, "selectedPois" | "customPois"> & { customPois?: string[] };
}

function buildFixture(spec: FixtureSpec): BenchFixture {
  const anchors = spec.anchorIndexes.map((i) => spec.candidates[i]);

  const userAnswers: UserAnswers = {
    ...spec.answers,
    selectedPois: anchors.map(candidate),
    customPois: spec.answers.customPois ?? [],
  };

  const rawFetch: RawFetch = {
    dateContext: dates(spec.startDate, spec.tripDays, spec.leadTimeDays, spec.season),
    destination: {
      resolved: true,
      lat: spec.lat,
      lon: spec.lon,
      timezone: spec.timezone,
      region: spec.region,
      countryCode: spec.countryCode,
    },
    weather: {
      available: spec.weatherDays !== null,
      historical: spec.weatherHistorical ?? false,
      days: spec.weatherDays ?? [],
    },
    holidays: { available: spec.holidays !== null, events: spec.holidays ?? [] },
    transportModes: {
      available: spec.transportModes !== null,
      modes: spec.transportModes ?? [],
    },
    candidatePois: { available: true, pois: spec.candidates.map(candidate) },
  };

  const reconciled = reconcileTrip(rawFetch, userAnswers);

  const pois: EnrichedPoi[] = anchors.map((p) => ({
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    openingHours: p.openingHours,
    closedDays: closedDaysFromOpeningHours(p.openingHours),
    visitMinutes: estimateVisitMinutes(p.kinds),
    visitMinutesEstimated: true,
    wheelchair: p.wheelchair ?? null,
    partial: p.openingHours === null,
  }));

  const poiDetails: PoiDetails = {
    pois,
    travelLegs: buildTravelLegs(
      pois
        .filter((p): p is EnrichedPoi & { lat: number; lon: number } => p.lat !== null && p.lon !== null)
        .map((p) => ({ name: p.name, lat: p.lat, lon: p.lon })),
      reconciled.transportModes
    ),
    notes: pois.some((p) => p.partial)
      ? [
          {
            field: "poiDetails",
            status: "estimated",
            detail: `${pois.filter((p) => p.partial).length} of ${pois.length} places have incomplete details.`,
          },
        ]
      : [],
  };

  return {
    id: spec.id,
    title: spec.title,
    covers: spec.covers,
    reconciled,
    poiDetails,
    baseItinerary: BASE_ITINERARIES[spec.id],
  };
}

// --- the fixtures ------------------------------------------------------------------------------

const SPECS: FixtureSpec[] = [
  {
    // The only fixture exercising the three inputs the pipeline gained last: a hard dietary
    // constraint, a step-free requirement that must outrank `high` energy, and logistics that
    // bound day 1 and the last day. Every other fixture leaves all three unstated, which is the
    // other case worth covering but not the one that can regress silently.
    id: "barcelona-access-dietary",
    title: "Barcelona — step-free, vegan, booked stay and flights",
    covers:
      "Dietary + accessibility + booked logistics all stated; step-free overrides high energy; OSM wheelchair tags present.",
    region: "Catalonia, Spain",
    lat: 41.3874,
    lon: 2.1686,
    timezone: "Europe/Madrid",
    countryCode: "ES",
    startDate: "2026-10-15",
    tripDays: 4,
    leadTimeDays: 58,
    season: "fall",
    weatherDays: [
      weather("2026-10-15", 17, 24, 10, "08:02", "19:31"),
      weather("2026-10-16", 18, 25, 0, "08:03", "19:29"),
      weather("2026-10-17", 16, 21, 70, "08:04", "19:28"),
      weather("2026-10-18", 17, 23, 20, "08:05", "19:26"),
    ],
    holidays: [{ date: "2026-10-17", name: "Fiesta Nacional observed", localName: "Fiesta Nacional" }],
    transportModes: ["walk", "transit"],
    candidates: [
      { name: "Sagrada Família", lat: 41.4036, lon: 2.1744, kinds: "religion,architecture", openingHours: "Mo-Su 09:00-18:00", wheelchair: "yes" },
      { name: "Park Güell", lat: 41.4145, lon: 2.1527, kinds: "gardens_and_parks", openingHours: "Mo-Su 09:30-18:00", wheelchair: "limited" },
      { name: "Casa Batlló", lat: 41.3917, lon: 2.1650, kinds: "architecture,historic", openingHours: "Mo-Su 09:00-20:00", wheelchair: "yes" },
      { name: "Mercat de Sant Josep de la Boqueria", lat: 41.3817, lon: 2.1717, kinds: "foods,marketplaces", openingHours: "Mo-Sa 08:00-20:30; Su off", wheelchair: "yes" },
      { name: "Bunkers del Carmel", lat: 41.4194, lon: 2.1619, kinds: "view_points", openingHours: "24/7", wheelchair: "no" },
      { name: "Museu Picasso", lat: 41.3851, lon: 2.1810, kinds: "museums", openingHours: "Tu-Su 10:00-19:00; Mo off", wheelchair: "yes" },
      { name: "Barceloneta Beach", lat: 41.3784, lon: 2.1925, kinds: "beaches,natural", openingHours: "24/7" },
      { name: "Gothic Quarter", lat: 41.3833, lon: 2.1766, kinds: "historic,architecture", openingHours: null },
    ],
    anchorIndexes: [0, 3, 5],
    answers: {
      purpose: "Anniversary trip; wheelchair user, so step-free routes matter more than covering ground",
      explorerStyle: "mixed",
      group: "couple",
      // Deliberately `high`: energy answers "how much do you want to be out", and on its own it
      // would produce walk_leg_cap=normal. The step-free requirement has to override it, which is
      // exactly the bug `deriveMobilityProfile` had while energy was the only input.
      energy: "high",
      crowds: "mixed",
      budget: 3200,
      priorities: ["Culture & History", "Food", "Photography"],
      topPriorities: ["Culture & History", "Food"],
      dietary: { tags: ["Vegan"], note: "severe tree-nut allergy" },
      accessibility: { stepFreeRequired: true, limitStairs: true, note: "manual wheelchair, no steps at all" },
      logistics: {
        arrivalTime: "13:45",
        // Null rather than invented: this fixture predates the arrival/departure *points*, and
        // null is exactly what "not stated" means to every rule that reads them.
        arrivalPoint: null,
        departureTime: "11:00",
        departurePoint: null,
        stayBooked: "Hotel Ronda Sant Pere (already paid)",
      },
    },
  },
  {
    id: "kyoto-couple-mixed",
    title: "Kyoto — couple, mixed pace, crowd-averse",
    covers: "Anchors with real hours + closed days; a holiday mid-trip; crowd_bias fully on.",
    region: "Kyoto Prefecture, Japan",
    lat: 35.0116,
    lon: 135.7681,
    timezone: "Asia/Tokyo",
    countryCode: "JP",
    startDate: "2026-09-19",
    tripDays: 4,
    leadTimeDays: 33,
    season: "fall",
    weatherDays: [
      weather("2026-09-19", 21, 29, 10, "05:41", "17:56"),
      weather("2026-09-20", 22, 30, 20, "05:42", "17:55"),
      weather("2026-09-21", 20, 25, 80, "05:42", "17:53"),
      weather("2026-09-22", 19, 27, 5, "05:43", "17:52"),
    ],
    holidays: [{ date: "2026-09-21", name: "Respect for the Aged Day", localName: "敬老の日" }],
    transportModes: ["walk", "transit"],
    candidates: [
      { name: "Fushimi Inari Taisha", lat: 34.9671, lon: 135.7727, kinds: "religion", openingHours: "24/7" },
      { name: "Kinkaku-ji", lat: 35.0394, lon: 135.7292, kinds: "religion", openingHours: "Mo-Su 09:00-17:00" },
      { name: "Nishiki Market", lat: 35.0050, lon: 135.7649, kinds: "foods", openingHours: "Mo-Su 09:30-18:00" },
      { name: "Kiyomizu-dera", lat: 34.9949, lon: 135.7850, kinds: "religion", openingHours: "Mo-Su 06:00-18:00" },
      { name: "Arashiyama Bamboo Grove", lat: 35.0170, lon: 135.6716, kinds: "natural", openingHours: "24/7" },
      { name: "Nijo Castle", lat: 35.0142, lon: 135.7481, kinds: "historic", openingHours: "Tu-Su 08:45-17:00; Mo off" },
      { name: "Gion district", lat: 35.0037, lon: 135.7752, kinds: "architecture", openingHours: null },
      { name: "Kyoto Railway Museum", lat: 34.9871, lon: 135.7368, kinds: "museums", openingHours: "We-Mo 10:00-17:00; Tu off" },
    ],
    anchorIndexes: [0, 1, 3, 5],
    answers: {
      purpose: "First trip to Japan, want temples and food without the worst crowds",
      explorerStyle: "mixed",
      group: "couple",
      energy: "moderate",
      crowds: "avoid",
      budget: 2600,
      priorities: ["Culture & History", "Food", "Nature & Outdoors", "Photography"],
      topPriorities: ["Culture & History", "Food"],
    },
  },
  {
    id: "lisbon-solo-offbeat",
    title: "Lisbon — solo, offbeat, no anchors",
    covers: "Plan-from-profile-only (zero anchors); high energy; crowd-loving; short trip.",
    region: "Lisboa, Portugal",
    lat: 38.7223,
    lon: -9.1393,
    timezone: "Europe/Lisbon",
    countryCode: "PT",
    startDate: "2026-10-08",
    tripDays: 3,
    leadTimeDays: 52,
    season: "fall",
    weatherDays: [
      weather("2026-10-08", 16, 24, 0, "07:31", "19:00"),
      weather("2026-10-09", 17, 25, 5, "07:32", "18:58"),
      weather("2026-10-10", 16, 22, 40, "07:33", "18:57"),
    ],
    holidays: [],
    transportModes: ["walk", "transit"],
    candidates: [
      { name: "Time Out Market Lisboa", lat: 38.7067, lon: -9.1459, kinds: "foods", openingHours: "Mo-Su 10:00-24:00" },
      { name: "LX Factory", lat: 38.7027, lon: -9.1786, kinds: "cultural", openingHours: "Mo-Su 08:00-23:00" },
      { name: "Miradouro da Senhora do Monte", lat: 38.7181, lon: -9.1329, kinds: "view_points", openingHours: "24/7" },
      { name: "Feira da Ladra", lat: 38.7156, lon: -9.1247, kinds: "shops", openingHours: "Tu,Sa 09:00-18:00" },
      { name: "Museu Nacional do Azulejo", lat: 38.7247, lon: -9.1136, kinds: "museums", openingHours: "Tu-Su 10:00-13:00,14:00-18:00; Mo off" },
      { name: "Cais do Sodré nightlife", lat: 38.7061, lon: -9.1449, kinds: "nightlife", openingHours: null },
    ],
    anchorIndexes: [],
    answers: {
      purpose: "Solo week away, want the local side rather than the postcard version",
      explorerStyle: "offbeat",
      group: "solo",
      energy: "high",
      crowds: "love",
      budget: 900,
      priorities: ["Food", "Nightlife", "Culture & History", "Photography"],
      topPriorities: ["Food", "Nightlife"],
    },
  },
  {
    id: "rome-family-slow",
    title: "Rome — family with kids, slowest pace",
    covers: "family_rules on; pace floors at 2 stops/day; a rainy day and a public holiday.",
    region: "Lazio, Italy",
    lat: 41.9028,
    lon: 12.4964,
    timezone: "Europe/Rome",
    countryCode: "IT",
    startDate: "2026-11-01",
    tripDays: 5,
    leadTimeDays: 76,
    season: "fall",
    weatherDays: [
      weather("2026-11-01", 11, 18, 20, "06:44", "16:56"),
      weather("2026-11-02", 12, 17, 70, "06:45", "16:55"),
      weather("2026-11-03", 10, 16, 90, "06:46", "16:54"),
      weather("2026-11-04", 9, 17, 10, "06:48", "16:53"),
      weather("2026-11-05", 10, 18, 0, "06:49", "16:52"),
    ],
    holidays: [{ date: "2026-11-01", name: "All Saints' Day", localName: "Tutti i santi" }],
    transportModes: ["walk", "transit"],
    candidates: [
      { name: "Colosseum", lat: 41.8902, lon: 12.4922, kinds: "historic", openingHours: "Mo-Su 09:00-16:30" },
      { name: "Villa Borghese gardens", lat: 41.9142, lon: 12.4922, kinds: "natural", openingHours: "24/7" },
      { name: "Explora Children's Museum", lat: 41.9110, lon: 12.4760, kinds: "museums", openingHours: "Tu-Su 10:00-18:00; Mo off" },
      { name: "Pantheon", lat: 41.8986, lon: 12.4769, kinds: "historic", openingHours: "Mo-Sa 09:00-19:00; Su 09:00-18:00" },
      { name: "Trastevere", lat: 41.8890, lon: 12.4696, kinds: "architecture", openingHours: null },
      { name: "Vatican Museums", lat: 41.9065, lon: 12.4536, kinds: "museums", openingHours: "Mo-Sa 09:00-18:00; Su off" },
      { name: "Piazza Navona", lat: 41.8992, lon: 12.4731, kinds: "architecture", openingHours: "24/7" },
    ],
    anchorIndexes: [0, 2, 3],
    answers: {
      purpose: "Half-term week with a 5 and an 8 year old",
      explorerStyle: "relaxed",
      group: "family_with_kids",
      energy: "low",
      crowds: "avoid",
      budget: 3200,
      priorities: ["Culture & History", "Food", "Family-Friendly"],
      topPriorities: ["Culture & History"],
    },
  },
  {
    id: "reykjavik-couple-packed",
    title: "Reykjavík — couple, packed, estimated weather",
    covers: "Beyond the forecast horizon (historical weather, flagged); very short daylight; fast pace.",
    region: "Capital Region, Iceland",
    lat: 64.1466,
    lon: -21.9426,
    timezone: "Atlantic/Reykjavik",
    countryCode: "IS",
    startDate: "2027-02-12",
    tripDays: 4,
    leadTimeDays: 179,
    season: "winter",
    weatherHistorical: true,
    weatherDays: [
      weather("2027-02-12", -3, 2, 60, "09:41", "17:52", true),
      weather("2027-02-13", -5, 1, 40, "09:38", "17:55", true),
      weather("2027-02-14", -2, 3, 80, "09:35", "17:58", true),
      weather("2027-02-15", -4, 2, 30, "09:32", "18:01", true),
    ],
    holidays: [],
    transportModes: ["walk", "drive"],
    candidates: [
      { name: "Hallgrímskirkja", lat: 64.1417, lon: -21.9266, kinds: "religion", openingHours: "Mo-Su 09:00-17:00" },
      { name: "Harpa Concert Hall", lat: 64.1503, lon: -21.9327, kinds: "cultural", openingHours: "Mo-Su 10:00-18:00" },
      { name: "Blue Lagoon", lat: 63.8804, lon: -22.4495, kinds: "natural", openingHours: "Mo-Su 08:00-21:00" },
      { name: "Þingvellir National Park", lat: 64.2559, lon: -21.1301, kinds: "natural", openingHours: "24/7" },
      { name: "Perlan", lat: 64.1290, lon: -21.9190, kinds: "museums", openingHours: "Mo-Su 09:00-22:00" },
      { name: "Sun Voyager", lat: 64.1475, lon: -21.9223, kinds: "cultural", openingHours: "24/7" },
    ],
    anchorIndexes: [0, 2],
    answers: {
      purpose: "Northern lights and hot springs, cramming as much in as the daylight allows",
      explorerStyle: "packed",
      group: "couple",
      energy: "high",
      crowds: "mixed",
      budget: 4000,
      priorities: ["Nature & Outdoors", "Photography", "Food"],
      topPriorities: ["Nature & Outdoors", "Photography"],
    },
  },
  {
    id: "bangkok-solo-degraded",
    title: "Bangkok — solo, packed, degraded sources",
    covers: "Holiday and transport data both unavailable; five anchors; peak-timing-OK crowd bias.",
    region: "Bangkok, Thailand",
    lat: 13.7563,
    lon: 100.5018,
    timezone: "Asia/Bangkok",
    countryCode: "TH",
    startDate: "2026-12-03",
    tripDays: 3,
    leadTimeDays: 108,
    season: "winter",
    weatherDays: [
      weather("2026-12-03", 24, 32, 10, "06:26", "17:52"),
      weather("2026-12-04", 24, 33, 0, "06:27", "17:52"),
      weather("2026-12-05", 25, 33, 20, "06:27", "17:53"),
    ],
    holidays: null,
    transportModes: null,
    candidates: [
      { name: "Grand Palace", lat: 13.7500, lon: 100.4913, kinds: "historic", openingHours: "Mo-Su 08:30-15:30" },
      { name: "Wat Pho", lat: 13.7465, lon: 100.4927, kinds: "religion", openingHours: "Mo-Su 08:00-18:30" },
      { name: "Chatuchak Weekend Market", lat: 13.7999, lon: 100.5503, kinds: "shops", openingHours: "Sa-Su 09:00-18:00" },
      { name: "Wat Arun", lat: 13.7437, lon: 100.4889, kinds: "religion", openingHours: "Mo-Su 08:00-18:00" },
      { name: "Jim Thompson House", lat: 13.7492, lon: 100.5282, kinds: "museums", openingHours: "Mo-Su 10:00-18:00" },
      { name: "Yaowarat (Chinatown)", lat: 13.7398, lon: 100.5088, kinds: "foods", openingHours: null },
    ],
    anchorIndexes: [0, 1, 3, 4, 5],
    answers: {
      purpose: "Stopover, want to see as much as possible in three days",
      explorerStyle: "packed",
      group: "solo",
      energy: "moderate",
      crowds: "love",
      budget: 700,
      priorities: ["Food", "Culture & History", "Shopping", "Photography"],
      topPriorities: ["Food", "Culture & History", "Shopping"],
    },
  },
  {
    id: "queenstown-couple-noweather",
    title: "Queenstown — couple, offbeat, weather unavailable",
    covers: "Southern-hemisphere season flip; weather fetch failed entirely; longest trip in the set.",
    region: "Otago, New Zealand",
    lat: -45.0312,
    lon: 168.6626,
    timezone: "Pacific/Auckland",
    countryCode: "NZ",
    startDate: "2026-09-26",
    tripDays: 5,
    leadTimeDays: 40,
    season: "spring",
    weatherDays: null,
    holidays: [],
    transportModes: ["walk", "drive"],
    candidates: [
      { name: "Skyline Gondola", lat: -45.0300, lon: 168.6560, kinds: "view_points", openingHours: "Mo-Su 09:00-21:00" },
      { name: "Lake Wakatipu waterfront", lat: -45.0336, lon: 168.6591, kinds: "natural", openingHours: "24/7" },
      { name: "Gibbston Valley wineries", lat: -45.0067, lon: 168.8283, kinds: "foods", openingHours: "Mo-Su 10:00-17:00" },
      { name: "Arrowtown", lat: -44.9401, lon: 168.8322, kinds: "historic", openingHours: null },
      { name: "Glenorchy road lookouts", lat: -44.8710, lon: 168.3856, kinds: "natural", openingHours: "24/7" },
      { name: "Onsen Hot Pools", lat: -44.9967, lon: 168.6389, kinds: "natural", openingHours: "Mo-Su 11:00-21:00" },
    ],
    anchorIndexes: [2, 4],
    answers: {
      purpose: "Quiet week, hiking and wine, avoiding the tour-bus stops",
      explorerStyle: "offbeat",
      group: "couple",
      energy: "high",
      crowds: "avoid",
      budget: 3500,
      priorities: ["Nature & Outdoors", "Food", "Wellness & Fitness", "Relaxation"],
      topPriorities: ["Nature & Outdoors", "Wellness & Fitness"],
    },
  },
];

export const BENCH_FIXTURES: BenchFixture[] = SPECS.map(buildFixture);

export function getFixture(id: string): BenchFixture | undefined {
  return BENCH_FIXTURES.find((f) => f.id === id);
}

/** Every POI the context could have grounded a stop in: anchors plus the fetched candidate list. */
export function knownPois(fixture: BenchFixture): { name: string; lat: number | null; lon: number | null }[] {
  const anchors = fixture.poiDetails.pois.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon }));
  const candidates = fixture.reconciled.rawFetch.candidatePois.pois.map((p) => ({
    name: p.name,
    lat: p.lat,
    lon: p.lon,
  }));
  const seen = new Set<string>();
  return [...anchors, ...candidates].filter((p) => {
    const key = p.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
