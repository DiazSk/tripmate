"use client";

import { useCallback, useState } from "react";
import { useMapCamera } from "./mapCamera";
import { geocodeDestination } from "./weather";
import { PlaceDetail, Stop } from "./types";

export function useTripCamera(destination: string) {
  const { flyToDestination, flyToPlace } = useMapCamera();
  const [destinationCoords, setDestinationCoords] = useState<{ lat: number; lon: number } | null>(
    null
  );
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const flyToDestinationByName = useCallback(
    async (name: string) => {
      const geo = await geocodeDestination(name);
      if (geo) {
        setDestinationCoords(geo);
        flyToDestination(geo.lat, geo.lon);
      }
    },
    [flyToDestination]
  );

  const selectStop = useCallback(
    async (stop: Stop) => {
      setSelectedStop(stop);
      flyToPlace(stop.lat, stop.lng);
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
    if (destinationCoords) flyToDestination(destinationCoords.lat, destinationCoords.lon);
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
