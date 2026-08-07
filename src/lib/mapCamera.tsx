"use client";

import { createContext, useCallback, useContext, useRef, ReactNode } from "react";
import type { Viewer } from "cesium";

interface MapCameraContextValue {
  setViewer: (viewer: Viewer | null) => void;
  flyToDestination: (lat: number, lng: number) => void;
  flyToPlace: (lat: number, lng: number) => void;
  resetGlobal: () => void;
}

const MapCameraContext = createContext<MapCameraContextValue | null>(null);

const DESTINATION_HEIGHT_M = 15000;
const PLACE_HEIGHT_M = 600;
const GLOBAL_HEIGHT_M = 20000000;

export function MapCameraProvider({ children }: { children: ReactNode }) {
  const viewerRef = useRef<Viewer | null>(null);

  const setViewer = useCallback((viewer: Viewer | null) => {
    viewerRef.current = viewer;
  }, []);

  const flyTo = useCallback((lat: number, lng: number, height: number, pitchDeg: number) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    import("cesium").then((Cesium) => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, height),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(pitchDeg),
          roll: 0,
        },
        duration: 2.5,
      });
    });
  }, []);

  const flyToDestination = useCallback(
    (lat: number, lng: number) => flyTo(lat, lng, DESTINATION_HEIGHT_M, -45),
    [flyTo]
  );
  const flyToPlace = useCallback(
    (lat: number, lng: number) => flyTo(lat, lng, PLACE_HEIGHT_M, -35),
    [flyTo]
  );
  const resetGlobal = useCallback(() => flyTo(20, 0, GLOBAL_HEIGHT_M, -90), [flyTo]);

  return (
    <MapCameraContext.Provider value={{ setViewer, flyToDestination, flyToPlace, resetGlobal }}>
      {children}
    </MapCameraContext.Provider>
  );
}

export function useMapCamera() {
  const ctx = useContext(MapCameraContext);
  if (!ctx) throw new Error("useMapCamera must be used within MapCameraProvider");
  return ctx;
}
