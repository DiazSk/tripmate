import { DayWeather } from "./weather";
import { TierId } from "./tiers";

export type StopCategory = "food" | "entry" | "transit" | "other";

export interface Stop {
  name: string;
  lat: number;
  lng: number;
  cost: number;
  note: string;
  time: string;
  durationLabel: string;
  tags: string[];
  category: StopCategory;
  actualCost?: number;
}

export interface Lodging {
  name: string;
  cost: number;
  note: string;
  actualCost?: number;
}

export interface DayPlan {
  date: string;
  weather: string;
  /** Structured forecast for this date, attached server-side from the real
   *  weather lookup (not authored by the model) — used for the icon/popover.
   *  Absent on itineraries saved before this field existed. */
  weatherDetail?: DayWeather;
  /** Short model-written narrative for the day's theme/flow. Absent on
   *  itineraries saved before this field existed. */
  summary?: string;
  lodging?: Lodging;
  stops: Stop[];
}

export interface Itinerary {
  tier: TierId;
  days: DayPlan[];
}

export interface TripSummary {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
}

export interface Trip extends TripSummary {
  itinerary: Itinerary;
}

export interface PlaceDetail {
  history: string;
  bestTime: string;
  tips: string[];
  duration: string;
}

export interface ItineraryPreferences {
  tags: string[];
  vibe: string | null;
}

export interface TraceSummary {
  id: string;
  type: string;
  status: string;
  model: string;
  durationMs: number | null;
  createdAt: string;
}

export interface TraceDetail extends TraceSummary {
  prompt: string;
  rawResponse: string | null;
  errorMessage: string | null;
}

export const CONTAINER_TYPES = [
  "vintage_envelope",
  "furoshiki_wrap",
  "travel_trunk",
  "classic_box",
] as const;
export type ContainerType = (typeof CONTAINER_TYPES)[number];

export const LID_TYPES = ["envelope_flap", "side_hinge_lid", "knot_open"] as const;
export type LidType = (typeof LID_TYPES)[number];

export interface ContainerTheme {
  containerType: ContainerType;
  themeTitle: string;
  primaryColor: string;
  stampOrIcon: string;
  lidType: LidType;
}

/** Used until the LLM-picked theme resolves, and whenever the destination is
 *  empty/general/unrecognized or the call fails — never leaves the box
 *  themeless. */
export const DEFAULT_CONTAINER_THEME: ContainerTheme = {
  containerType: "classic_box",
  themeTitle: "Pack your bags",
  primaryColor: "#ea580c",
  stampOrIcon: "compass",
  lidType: "side_hinge_lid",
};
