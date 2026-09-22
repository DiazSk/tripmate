import { fetchWithSession } from "./session";
import type { Trip, TripSummary, TravelerProfile, TripStatus } from "./types";

export async function listTrips(status: TripStatus = "saved"): Promise<TripSummary[] | undefined> {
  try {
    const res = await fetchWithSession(`/api/trips?status=${status}`, {});
    if (!res.ok) return undefined;
    const body = await res.json();
    return body.trips as TripSummary[];
  } catch {
    return undefined;
  }
}

export async function getTrip(id: string): Promise<Trip | undefined> {
  try {
    const res = await fetchWithSession(`/api/trips/${id}`, {});
    if (!res.ok) return undefined;
    return (await res.json()) as Trip;
  } catch {
    return undefined;
  }
}

export async function getProfile(): Promise<TravelerProfile | null | undefined> {
  try {
    const res = await fetchWithSession("/api/profile", {});
    if (!res.ok) return undefined;
    const body = await res.json();
    return body.profile as TravelerProfile | null;
  } catch {
    return undefined;
  }
}
