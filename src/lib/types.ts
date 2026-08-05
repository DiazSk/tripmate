import { TierId } from "./tiers";

export interface Stop {
  name: string;
  lat: number;
  lng: number;
  cost: number;
  note: string;
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
