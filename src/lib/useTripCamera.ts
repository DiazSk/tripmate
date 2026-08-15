"use client";

import { useCallback, useState } from "react";
import { useMapCamera } from "./mapCamera";
import { geocodeDestination } from "./weather";
import { PlaceDetail, Stop } from "./types";

export function useTripCamera(destination: string, tripId?: string) {
  const { flyToDestination, flyToPlace, setActivePin, showHighways } = useMapCamera();
  const [destinationCoords, setDestinationCoords] = useState<{
    lat: number;
    lon: number;
    name: string;
  } | null>(null);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  /**
   * Geocodes `name` and records the coordinates (closeDetail flies back to them). `fly`
   * additionally moves the camera there — pass `false` when an itinerary is about to frame
   * its own route, since the geocode resolves a few hundred ms later and would otherwise
   * land second and clobber the better framing with a visible double flight.
   *
   * Returns the geocode result so a caller can tell "not found" from "found", or null on
   * either a miss or a network failure. The home page now calls this from the destination
   * field's blur handler, where an empty string or a thrown fetch is routine rather than
   * exceptional — hence the guard and the catch here rather than at that one call site.
   */
  const flyToDestinationByName = useCallback(
    async (name: string, fly = true) => {
      if (!name.trim()) return null;
      let geo: Awaited<ReturnType<typeof geocodeDestination>> = null;
      try {
        geo = await geocodeDestination(name);
      } catch {
        return null;
      }
      if (geo) {
        setDestinationCoords(geo);
        // Independent of `fly`: highways are ambient map context for wherever the trip's
        // destination turns out to be, not tied to whether the camera itself flies there (a
        // saved trip with stops already frames its own day route and skips the flight).
        showHighways(geo.lat, geo.lon);
        if (fly) flyToDestination(geo.lat, geo.lon, geo.name);
      }
      return geo;
    },
    [flyToDestination, showHighways]
  );

  /** Same as flyToDestinationByName, but for callers (e.g. an autocomplete suggestion) that
   *  already know the coordinates — skips the redundant re-geocode round-trip. */
  const flyToDestinationByCoords = useCallback(
    (lat: number, lon: number, name: string) => {
      setDestinationCoords({ lat, lon, name });
      showHighways(lat, lon);
      flyToDestination(lat, lon, name);
    },
    [flyToDestination, showHighways]
  );

  const selectStop = useCallback(
    async (stop: Stop) => {
      setSelectedStop(stop);
      flyToPlace(stop.lat, stop.lng, stop.name);
      setActivePin({ lat: stop.lat, lng: stop.lng });
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const res = await fetch("/api/place-detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: stop.name,
            destination,
            lat: stop.lat,
            lng: stop.lng,
            tripId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load details");
        setDetail(data.detail);
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : "Failed to load details");
      } finally {
        setDetailLoading(false);
      }
    },
    [flyToPlace, setActivePin, destination, tripId]
  );

  const closeDetail = useCallback(() => {
    setSelectedStop(null);
    setActivePin(null);
    if (destinationCoords)
      flyToDestination(destinationCoords.lat, destinationCoords.lon, destinationCoords.name);
  }, [destinationCoords, flyToDestination, setActivePin]);

  return {
    flyToDestinationByName,
    flyToDestinationByCoords,
    selectStop,
    closeDetail,
    selectedStop,
    detail,
    detailLoading,
    detailError,
  };
}
