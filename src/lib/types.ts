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
