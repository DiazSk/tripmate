export interface Stop {
  name: string;
  lat: number;
  lng: number;
  cost: number;
  note: string;
}

export interface DayPlan {
  date: string;
  weather: string;
  stops: Stop[];
}

export interface Itinerary {
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
