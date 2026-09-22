import { fetchWithSession } from "./session";
import type { PlacePhoto, Trip, TripSummary, TravelerProfile, TripStatus } from "./types";

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

/**
 * `GET /api/place-photo?name=` — the photograph and extract for a place.
 *
 * **The 200/503 split is the caching contract and it is the whole subtlety.** A miss returns all
 * three fields `null` with a 200, deliberately, so the client can cache "this place has no
 * photograph" and stop asking. A 503 means the lookup itself failed and is retryable — caching
 * that would leave a trip photo-less for the rest of the session. So a returned object is always
 * safe to cache; `undefined` never is.
 */
export async function placePhoto(name: string): Promise<PlacePhoto | undefined> {
  const trimmed = name.trim();
  // A caller passing a field the traveler hasn't filled in would otherwise fire a lookup for ""
  // on every render, which can only 400.
  if (!trimmed) return undefined;
  try {
    const res = await fetchWithSession(`/api/place-photo?name=${encodeURIComponent(trimmed)}`, {});
    if (!res.ok) return undefined;
    return (await res.json()) as PlacePhoto;
  } catch {
    return undefined;
  }
}
