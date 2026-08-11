"use client";

import { useCallback, useState } from "react";
import { useMapCamera } from "./mapCamera";
import { geocodeDestination } from "./weather";
import { PlaceDetail, Stop } from "./types";

export function useTripCamera(destination: string) {
  const { flyToDestination, flyToPlace } = useMapCamera();
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
        if (fly) flyToDestination(geo.lat, geo.lon, geo.name);
      }
      return geo;
    },
    [flyToDestination]
  );

  const selectStop = useCallback(
    async (stop: Stop) => {
      setSelectedStop(stop);
      flyToPlace(stop.lat, stop.lng, stop.name);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const res = await fetch("/api/place-detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: stop.name, destination, lat: stop.lat, lng: stop.lng }),
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
    [flyToPlace, destination]
  );

  const closeDetail = useCallback(() => {
    setSelectedStop(null);
    if (destinationCoords)
      flyToDestination(destinationCoords.lat, destinationCoords.lon, destinationCoords.name);
  }, [destinationCoords, flyToDestination]);

  return {
    flyToDestinationByName,
    selectStop,
    closeDetail,
    selectedStop,
    detail,
    detailLoading,
    detailError,
  };
}
