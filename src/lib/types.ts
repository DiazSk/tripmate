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
