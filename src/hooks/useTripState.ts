"use client";

import { useCallback, useRef, useState } from "react";
import { ContainerTheme, DEFAULT_CONTAINER_THEME, Itinerary, ItineraryPreferences } from "@/lib/types";
import type { FlyToOptions, GlobePoi } from "./useCesiumViewer";

// IDLE: search form showing, 2D gift box hidden.
// SEARCHING: form just collapsed, 2D gift box open at bottom-center, geocode in flight.
// PREFERENCES: destination resolved, box open, preference chips interactive.
// GENERATING: preferences submitted — box lid slides shut, camera pans (fixed
//   position, heading only) then flies to the destination, and the itinerary
//   POST all happen concurrently here.
// DASHBOARD_ACTIVE: itinerary ready, dashboard shown.
export type TripStatus = "IDLE" | "SEARCHING" | "PREFERENCES" | "GENERATING" | "DASHBOARD_ACTIVE";

export interface TripFormData {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
}

interface GlobeControls {
  flyTo: (lon: number, lat: number, options?: FlyToOptions) => Promise<void>;
  panTo: (lon: number, lat: number, durationSeconds?: number) => Promise<number>;
  resetToGlobalView: () => Promise<void>;
  setPois: (pois: GlobePoi[]) => void;
  setHoveredPoi: (key: string | null) => void;
  stopRotating: () => void;
}

const DEFAULT_FORM: TripFormData = {
  destination: "",
  startDate: "",
  endDate: "",
  budget: 1000,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function poisFromItinerary(itinerary: Itinerary): GlobePoi[] {
  return itinerary.days.flatMap((day, di) =>
    day.stops
      .filter(
        (stop) =>
          typeof stop.lat === "number" &&
          typeof stop.lng === "number" &&
          !Number.isNaN(stop.lat) &&
          !Number.isNaN(stop.lng)
      )
      .map((stop, si) => ({ key: `${di}-${si}`, name: stop.name, lat: stop.lat, lng: stop.lng }))
  );
}

// Decorative and non-blocking: the unboxing container just shows the default
// theme until/unless this resolves, so a slow or failed call never holds up
// the actual search flow.
async function fetchContainerTheme(destination: string): Promise<ContainerTheme> {
  try {
    const res = await fetch(`/api/container-theme?destination=${encodeURIComponent(destination)}`);
    const data = await res.json();
    return data.theme ?? DEFAULT_CONTAINER_THEME;
  } catch {
    return DEFAULT_CONTAINER_THEME;
  }
}

async function postItinerary(body: Record<string, unknown>): Promise<{
  itinerary: Itinerary;
  traceId: string | null;
}> {
  const res = await fetch("/api/itinerary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to generate itinerary");
  return { itinerary: data.itinerary, traceId: data.traceId ?? null };
}

export function useTripState(globe: GlobeControls) {
  const [status, setStatus] = useState<TripStatus>("IDLE");
  const [form, setForm] = useState<TripFormData>(DEFAULT_FORM);

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [containerTheme, setContainerTheme] = useState<ContainerTheme>(DEFAULT_CONTAINER_THEME);
  const [hoveredStop, setHoveredStopState] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destinationRef = useRef<{ lon: number; lat: number } | null>(null);

  const submitDestination = useCallback(
    async (data: TripFormData) => {
      setForm(data);
      setError(null);
      setStatus("SEARCHING"); // triggers the card collapse + 2D gift box appearing, both purely CSS-driven off `status`
      setContainerTheme(DEFAULT_CONTAINER_THEME); // reset for the new search; swaps in below once resolved
      globe.stopRotating();
      fetchContainerTheme(data.destination).then(setContainerTheme);
      try {
        const res = await fetch(`/api/geocode?destination=${encodeURIComponent(data.destination)}`);
        const geo = await res.json();
        if (!res.ok || typeof geo.lat !== "number") {
          throw new Error(geo.error || "Couldn't find that destination");
        }
        destinationRef.current = { lon: geo.lng, lat: geo.lat };
        setStatus("PREFERENCES");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setStatus("IDLE");
      }
    },
    [globe]
  );

  const generate = useCallback(
    async (preferences: ItineraryPreferences | null) => {
      const destination = destinationRef.current;
      setStatus("GENERATING"); // bubble-collapse + box-lid-shut CSS animations play automatically off this
      setGenerating(true);
      setError(null);
      try {
        await sleep(500); // let the bubble collapse / lid-close read before the camera starts moving
        // Panning shot: camera position stays fixed, only the heading rotates
        // to aim at the destination — then the actual descent (flyTo) reuses
        // that same heading so there's no jarring snap when it starts moving.
        const heading = destination ? await globe.panTo(destination.lon, destination.lat, 1.8) : 0;
        const flight = destination
          ? globe.flyTo(destination.lon, destination.lat, {
              durationSeconds: 3,
              easing: "CUBIC_IN_OUT",
              headingDegrees: heading,
            })
          : Promise.resolve();
        const [result] = await Promise.all([postItinerary({ ...form, preferences }), flight]);

        setItinerary(result.itinerary);
        setTraceId(result.traceId);
        globe.setPois(poisFromItinerary(result.itinerary)); // pins burst onto the map
        setStatus("DASHBOARD_ACTIVE");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setStatus("PREFERENCES");
      } finally {
        setGenerating(false);
      }
    },
    [form, globe]
  );

  const refine = useCallback(
    async (feedback: string) => {
      setRefining(true);
      setError(null);
      try {
        const result = await postItinerary({ ...form, previousItinerary: itinerary, feedback });
        setItinerary(result.itinerary);
        setTraceId(result.traceId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setRefining(false);
      }
    },
    [form, itinerary]
  );

  const save = useCallback(async () => {
    if (!itinerary) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, itinerary }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save trip");
      return data.id as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }, [form, itinerary]);

  const reset = useCallback(async () => {
    setItinerary(null);
    setTraceId(null);
    setError(null);
    setStatus("IDLE");
    destinationRef.current = null;
    await globe.resetToGlobalView();
  }, [globe]);

  const setHoveredStop = useCallback(
    (key: string | null) => {
      setHoveredStopState(key);
      globe.setHoveredPoi(key);
    },
    [globe]
  );

  return {
    status,
    form,
    itinerary,
    traceId,
    containerTheme,
    hoveredStop,
    setHoveredStop,
    generating,
    refining,
    saving,
    error,
    submitDestination,
    generate,
    refine,
    save,
    reset,
  };
}
