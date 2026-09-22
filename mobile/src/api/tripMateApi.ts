import { fetchWithSession } from "./session";
import type { Trip, TripSummary, TravelerProfile, TripStatus } from "./types";

export async function listTrips(status: TripStatus = "saved"): Promise<TripSummary[] | undefined> {
  const res = await fetchWithSession(`/api/trips?status=${status}`, {});
  if (!res.ok) return undefined;
  const body = await res.json();
  return body.trips as TripSummary[];
}

export async function getTrip(id: string): Promise<Trip | undefined> {
  const res = await fetchWithSession(`/api/trips/${id}`, {});
  if (!res.ok) return undefined;
  return (await res.json()) as Trip;
}

export async function getProfile(): Promise<TravelerProfile | null | undefined> {
  const res = await fetchWithSession("/api/profile", {});
  if (!res.ok) return undefined;
  const body = await res.json();
  return body.profile as TravelerProfile | null;
}
