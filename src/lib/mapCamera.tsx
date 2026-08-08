"use client";

import { createContext, useCallback, useContext, useRef, ReactNode } from "react";
import type { Entity, Viewer } from "cesium";

interface MapCameraContextValue {
  setViewer: (viewer: Viewer | null) => void;
  flyToDestination: (lat: number, lng: number, label?: string) => void;
  flyToPlace: (lat: number, lng: number, label?: string) => void;
  resetGlobal: () => void;
}

const MapCameraContext = createContext<MapCameraContextValue | null>(null);

const DESTINATION_HEIGHT_M = 15000;
const PLACE_HEIGHT_M = 600;
const GLOBAL_HEIGHT_M = 20000000;
const LABEL_COLOR = "#f5f1e8";

// Cesium's PinBuilder only draws its own squat rounded-square marker, so the classic teardrop
// comes from an inline SVG instead. `encodeURIComponent` rather than `btoa` — this module is
// imported during SSR, where `btoa` doesn't exist.
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32"><path d="M12 .8C6 .8 1.2 5.6 1.2 11.6c0 8 10.8 19.6 10.8 19.6s10.8-11.6 10.8-19.6C22.8 5.6 18 .8 12 .8z" fill="#e03131" stroke="#8f1d1d" stroke-width="1.2" stroke-linejoin="round"/><circle cx="12" cy="11.6" r="4.2" fill="#fff"/></svg>`;
const PIN_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PIN_SVG)}`;

type Flight = [lat: number, lng: number, height: number, pitchDeg: number, label?: string];

export function MapCameraProvider({ children }: { children: ReactNode }) {
  const viewerRef = useRef<Viewer | null>(null);
  const markerRef = useRef<Entity | null>(null);
  const pendingRef = useRef<Flight | null>(null);

  const flyTo = useCallback(
    (lat: number, lng: number, height: number, pitchDeg: number, label?: string) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) {
        // The viewer registers only once the 3D tileset has loaded, which takes seconds — long
        // after a trip page has fetched its trip and asked to fly. Hold the request and replay
        // it on registration instead of dropping it.
        pendingRef.current = [lat, lng, height, pitchDeg, label];
        return;
      }
      // Flying toward a specific place means the globe shouldn't keep auto-rotating
      // under it — see stopAutoRotate in GlobeBackground.
      (viewer as Viewer & { stopAutoRotate?: () => void }).stopAutoRotate?.();
      import("cesium").then((Cesium) => {
        // The viewer can be torn down while this dynamic import is in flight.
        if (viewer.isDestroyed()) return;

        // One marker at a time: the pin always sits wherever the camera last flew, so a
        // labelless flight (the global reset) just clears it.
        if (markerRef.current) viewer.entities.remove(markerRef.current);
        markerRef.current = label
          ? viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(lng, lat),
              billboard: {
                image: PIN_IMAGE,
                width: 30,
                height: 40,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                // Without this the photorealistic tiles bury the pin inside nearby buildings.
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              label: {
                text: label,
                font: '500 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
                fillColor: Cesium.Color.fromCssColorString(LABEL_COLOR),
                outlineColor: Cesium.Color.fromCssColorString("#2b2620"),
                outlineWidth: 4,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -44),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            })
          : null;

        // Frame the target rather than hovering over it: `camera.flyTo` puts the camera *at*
        // these coordinates, so at a downward pitch the place itself sits at nadir, outside the
        // frustum — you'd fly to Rome and never see Rome. A bounding sphere keeps it centred,
        // with `height` read as distance-to-target instead of altitude.
        viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lng, lat), 0),
          {
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(pitchDeg), height),
            duration: 2.5,
          }
        );
      });
    },
    []
  );

  const setViewer = useCallback(
    (viewer: Viewer | null) => {
      viewerRef.current = viewer;
      if (!viewer) {
        markerRef.current = null;
        return;
      }
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) flyTo(...pending);
    },
    [flyTo]
  );

  const flyToDestination = useCallback(
    (lat: number, lng: number, label?: string) =>
      flyTo(lat, lng, DESTINATION_HEIGHT_M, -45, label),
    [flyTo]
  );
  const flyToPlace = useCallback(
    (lat: number, lng: number, label?: string) => flyTo(lat, lng, PLACE_HEIGHT_M, -35, label),
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
