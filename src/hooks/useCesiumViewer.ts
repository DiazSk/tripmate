"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as CesiumNS from "cesium";

/** Matches the `${dayIndex}-${stopIndex}` convention DayList/ItineraryMap already use for hover-sync. */
export interface GlobePoi {
  key: string;
  name: string;
  lat: number;
  lng: number;
}

export interface FlyToOptions {
  headingDegrees?: number;
  pitchDegrees?: number;
  heightMeters?: number;
  durationSeconds?: number;
  easing?: "QUADRATIC_IN_OUT" | "CUBIC_IN_OUT";
}

const ROTATE_RADIANS_PER_TICK = -0.00012;
// Low Earth Orbit framing: Earth's curved limb sweeps across the bottom half
// of the viewport, leaving the top half open to deep space.
const GLOBAL_VIEW_HEIGHT = 2_200_000;
const GLOBAL_VIEW_LON = -75.0;
const GLOBAL_VIEW_LAT = 15.0;
const GLOBAL_VIEW_PITCH_DEGREES = -40.0;
const GLOBAL_VIEW_ORIENTATION = {
  headingDegrees: 0.0,
  pitchDegrees: GLOBAL_VIEW_PITCH_DEGREES,
  rollDegrees: 0.0,
};
const DEFAULT_PIN_COLOR = "#78716c"; // stone-500
const HOVER_PIN_COLOR = "#ea580c"; // orange-600, matches DayList/ItineraryMap hover color

// Foreground spacecraft placeholder: a generic sleek silhouette (not any
// specific licensed/copyrighted ship design), kept camera-relative via a
// CallbackProperty so it stays framed in the foreground instead of drifting
// off with the idle auto-rotation like an Earth-fixed entity would.
const SHIP_FORWARD_METERS = 1400;
const SHIP_RIGHT_METERS = 500;
const SHIP_DOWN_METERS = 220;

function addSpacecraft(viewer: CesiumNS.Viewer, Cesium: typeof CesiumNS) {
  // Camera-relative offset (forward/right/up, all in meters) recomputed every
  // frame, so the whole assembly stays framed in the foreground instead of
  // drifting off with the idle auto-rotation like an Earth-fixed entity would.
  const offsetPosition = (rightMeters: number, upMeters: number) =>
    new Cesium.CallbackPositionProperty(() => {
      const camera = viewer.camera;
      const position = Cesium.Cartesian3.clone(camera.position, new Cesium.Cartesian3());
      Cesium.Cartesian3.add(
        position,
        Cesium.Cartesian3.multiplyByScalar(
          camera.direction,
          SHIP_FORWARD_METERS,
          new Cesium.Cartesian3()
        ),
        position
      );
      Cesium.Cartesian3.add(
        position,
        Cesium.Cartesian3.multiplyByScalar(camera.right, rightMeters, new Cesium.Cartesian3()),
        position
      );
      Cesium.Cartesian3.add(
        position,
        Cesium.Cartesian3.multiplyByScalar(camera.up, upMeters, new Cesium.Cartesian3()),
        position
      );
      return position;
    }, false);

  const shipOrientation = new Cesium.CallbackProperty(() => {
    const camera = viewer.camera;
    const rotation = new Cesium.Matrix3();
    Cesium.Matrix3.setColumn(rotation, 0, camera.right, rotation);
    Cesium.Matrix3.setColumn(rotation, 1, camera.direction, rotation);
    Cesium.Matrix3.setColumn(rotation, 2, camera.up, rotation);
    return Cesium.Quaternion.fromRotationMatrix(rotation);
  }, false);

  const hullColor = Cesium.Color.fromCssColorString("#4b5563"); // slate-600, generic dark hull
  const panelColor = Cesium.Color.fromCssColorString("#1d4ed8").withAlpha(0.85); // blue-700, solar-panel-ish
  const hullUp = -SHIP_DOWN_METERS;

  viewer.entities.add({
    id: "spacecraft-hull",
    position: offsetPosition(SHIP_RIGHT_METERS, hullUp),
    orientation: shipOrientation,
    box: {
      dimensions: new Cesium.Cartesian3(160, 34, 34),
      material: hullColor,
      outline: true,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.4),
    },
  });

  // Wings flank the hull left/right (along the camera's right axis), not stacked above/below it.
  viewer.entities.add({
    id: "spacecraft-panel-left",
    position: offsetPosition(SHIP_RIGHT_METERS + 110, hullUp),
    orientation: shipOrientation,
    box: {
      dimensions: new Cesium.Cartesian3(120, 4, 60),
      material: panelColor,
      outline: true,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.4),
    },
  });

  viewer.entities.add({
    id: "spacecraft-panel-right",
    position: offsetPosition(SHIP_RIGHT_METERS - 110, hullUp),
    orientation: shipOrientation,
    box: {
      dimensions: new Cesium.Cartesian3(120, 4, 60),
      material: panelColor,
      outline: true,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.4),
    },
  });
}

// Clustering thresholds: pins within 60px of each other on screen collapse
// into a single cluster marker once there are 2+ of them, which is what
// actually fixes overlapping pin labels — labels stay attached to individual
// pins, so decluttering has to happen at the entity level, not the label level.
const CLUSTER_PIXEL_RANGE = 60;
const CLUSTER_MINIMUM_SIZE = 2;

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// Great-circle initial bearing (compass degrees, 0 = north, clockwise) from
// one lon/lat to another — used to aim a fixed-position camera pan at a
// destination without needing Cesium's own math helpers.
function bearingDegrees(fromLon: number, fromLat: number, toLon: number, toLat: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(fromLat);
  const lat2 = toRad(toLat);
  const dLon = toRad(toLon - fromLon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearingRad = Math.atan2(y, x);
  return ((bearingRad * 180) / Math.PI + 360) % 360;
}

// Pin "burst" entrance once the camera lands at a destination: each pin pops
// in with a staggered bouncy scale-up rather than just appearing instantly.
const POI_BURST_STAGGER_MS = 70;
const POI_BURST_DURATION_MS = 450;

export function useCesiumViewer(containerRef: React.RefObject<HTMLDivElement | null>) {
  const viewerRef = useRef<CesiumNS.Viewer | null>(null);
  const cesiumRef = useRef<typeof CesiumNS | null>(null);
  const rotatingRef = useRef(true);
  const poiDataSourceRef = useRef<CesiumNS.CustomDataSource | null>(null);
  const poiEntitiesRef = useRef<Map<string, CesiumNS.Entity>>(new Map());
  const pinImagesRef = useRef<{ default: HTMLCanvasElement; hovered: HTMLCanvasElement } | null>(
    null
  );
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let viewer: CesiumNS.Viewer | null = null;
    let stopRotation: (() => void) | null = null;
    let canvas: HTMLCanvasElement | null = null;

    const init = async () => {
      (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium";
      const Cesium = await import("cesium");
      if (disposed) return;
      cesiumRef.current = Cesium;

      const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
      let terrainProvider: CesiumNS.TerrainProvider;
      let baseLayer: CesiumNS.ImageryLayer;

      if (ionToken) {
        Cesium.Ion.defaultAccessToken = ionToken;
        try {
          terrainProvider = await Cesium.createWorldTerrainAsync();
        } catch {
          terrainProvider = new Cesium.EllipsoidTerrainProvider();
        }
        baseLayer = Cesium.ImageryLayer.fromProviderAsync(Cesium.createWorldImageryAsync(), {});
      } else {
        // No ion token configured: Cesium's bundled Natural Earth II demo
        // texture is very low-resolution and looks pixelated up close — the
        // same free OpenStreetMap raster tiles ItineraryMap.tsx already uses
        // via Leaflet look far sharper and need no token/signup.
        terrainProvider = new Cesium.EllipsoidTerrainProvider();
        baseLayer = Cesium.ImageryLayer.fromProviderAsync(
          Promise.resolve(
            new Cesium.UrlTemplateImageryProvider({
              url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
              subdomains: ["a", "b", "c"],
              credit: "© OpenStreetMap contributors",
              maximumLevel: 19,
            })
          ),
          {}
        );
      }
      if (disposed) return;

      // Detached (never appended) so the default Cesium credit/logo overlay never renders.
      const creditContainer = document.createElement("div");

      viewer = new Cesium.Viewer(container, {
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        navigationHelpButton: false,
        navigationInstructionsInitiallyVisible: false,
        creditContainer,
        terrainProvider,
        baseLayer,
        // Needed so the header-contrast sampler can drawImage() this canvas
        // and read its pixels — without this the WebGL buffer is cleared
        // before any 2D-canvas readback gets a chance to see it.
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
        // Cesium's default (true) ignores devicePixelRatio and renders at the
        // browser's lower "recommended" resolution — that's what was causing
        // the blurriness on Retina/high-DPI screens, not fixing it. false
        // makes Cesium render at devicePixelRatio natively; resolutionScale
        // (left at its default of 1) is a *further* multiplier on top of
        // that, so it must not also be set to devicePixelRatio here or the
        // two compound (DPR² canvas pixels instead of DPR).
        useBrowserRecommendedResolution: false,
      });
      viewer.scene.msaaSamples = 4;
      viewer.scene.globe.maximumScreenSpaceError = 1.5;
      viewer.scene.globe.enableLighting = true;
      viewer.scene.globe.showGroundAtmosphere = true;
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;

      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          GLOBAL_VIEW_LON,
          GLOBAL_VIEW_LAT,
          GLOBAL_VIEW_HEIGHT
        ),
        orientation: {
          heading: Cesium.Math.toRadians(GLOBAL_VIEW_ORIENTATION.headingDegrees),
          pitch: Cesium.Math.toRadians(GLOBAL_VIEW_ORIENTATION.pitchDegrees),
          roll: Cesium.Math.toRadians(GLOBAL_VIEW_ORIENTATION.rollDegrees),
        },
      });

      addSpacecraft(viewer, Cesium);

      viewer.clock.onTick.addEventListener(() => {
        if (rotatingRef.current && viewer) {
          viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, ROTATE_RADIANS_PER_TICK);
        }
      });

      const pinBuilder = new Cesium.PinBuilder();
      pinImagesRef.current = {
        default: pinBuilder.fromColor(Cesium.Color.fromCssColorString(DEFAULT_PIN_COLOR), 32),
        hovered: pinBuilder.fromColor(Cesium.Color.fromCssColorString(HOVER_PIN_COLOR), 40),
      };

      // POIs live in their own DataSource (not viewer.entities directly) because
      // Cesium's built-in decluttering — EntityCluster — only clusters entities
      // that belong to a DataSource's collection.
      const poiDataSource = new Cesium.CustomDataSource("pois");
      await viewer.dataSources.add(poiDataSource);
      poiDataSource.clustering.enabled = true;
      poiDataSource.clustering.pixelRange = CLUSTER_PIXEL_RANGE;
      poiDataSource.clustering.minimumClusterSize = CLUSTER_MINIMUM_SIZE;
      poiDataSourceRef.current = poiDataSource;

      stopRotation = () => {
        rotatingRef.current = false;
      };
      canvas = viewer.canvas;
      canvas.addEventListener("mousedown", stopRotation);
      canvas.addEventListener("wheel", stopRotation);
      canvas.addEventListener("touchstart", stopRotation);

      viewerRef.current = viewer;
      setReady(true);
    };

    init();

    return () => {
      disposed = true;
      if (canvas && stopRotation) {
        canvas.removeEventListener("mousedown", stopRotation);
        canvas.removeEventListener("wheel", stopRotation);
        canvas.removeEventListener("touchstart", stopRotation);
      }
      viewerRef.current = null;
      viewer?.destroy();
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRotating = useCallback(() => {
    rotatingRef.current = false;
  }, []);

  const flyTo = useCallback((lon: number, lat: number, options?: FlyToOptions) => {
    return new Promise<void>((resolve) => {
      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      if (!viewer || !Cesium) {
        resolve();
        return;
      }
      rotatingRef.current = false;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, options?.heightMeters ?? 12_000),
        orientation: {
          heading: Cesium.Math.toRadians(options?.headingDegrees ?? 20),
          pitch: Cesium.Math.toRadians(options?.pitchDegrees ?? -35),
          roll: 0,
        },
        duration: options?.durationSeconds ?? 4.0,
        easingFunction:
          options?.easing === "CUBIC_IN_OUT"
            ? Cesium.EasingFunction.CUBIC_IN_OUT
            : Cesium.EasingFunction.QUADRATIC_IN_OUT,
        complete: () => resolve(),
        cancel: () => resolve(),
      });
    });
  }, []);

  // Panning shot: camera position is left completely untouched (a "tripod"
  // pan, not a flyTo/zoom) — only the heading rotates in place to aim at the
  // destination's bearing. Resolves with the heading (degrees) it settled on,
  // so a caller can hand that same heading to flyTo() afterward and avoid a
  // jarring snap when the camera then starts actually moving toward it.
  const panTo = useCallback((lon: number, lat: number, durationSeconds = 1.8) => {
    return new Promise<number>((resolve) => {
      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      if (!viewer || !Cesium) {
        resolve(0);
        return;
      }
      rotatingRef.current = false;
      const cameraCarto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
      const headingDeg = bearingDegrees(
        Cesium.Math.toDegrees(cameraCarto.longitude),
        Cesium.Math.toDegrees(cameraCarto.latitude),
        lon,
        lat
      );
      const currentPosition = Cesium.Cartesian3.clone(viewer.camera.position, new Cesium.Cartesian3());
      viewer.camera.flyTo({
        destination: currentPosition,
        orientation: {
          heading: Cesium.Math.toRadians(headingDeg),
          pitch: Cesium.Math.toRadians(GLOBAL_VIEW_PITCH_DEGREES),
          roll: 0,
        },
        duration: durationSeconds,
        easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
        complete: () => resolve(headingDeg),
        cancel: () => resolve(headingDeg),
      });
    });
  }, []);

  const clearPois = useCallback(() => {
    const dataSource = poiDataSourceRef.current;
    if (!dataSource) return;
    for (const entity of poiEntitiesRef.current.values()) {
      dataSource.entities.remove(entity);
    }
    poiEntitiesRef.current.clear();
  }, []);

  const resetToGlobalView = useCallback(() => {
    return new Promise<void>((resolve) => {
      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      clearPois();
      if (!viewer || !Cesium) {
        rotatingRef.current = true;
        resolve();
        return;
      }
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          GLOBAL_VIEW_LON,
          GLOBAL_VIEW_LAT,
          GLOBAL_VIEW_HEIGHT
        ),
        orientation: {
          heading: Cesium.Math.toRadians(GLOBAL_VIEW_ORIENTATION.headingDegrees),
          pitch: Cesium.Math.toRadians(GLOBAL_VIEW_ORIENTATION.pitchDegrees),
          roll: Cesium.Math.toRadians(GLOBAL_VIEW_ORIENTATION.rollDegrees),
        },
        duration: 2.5,
        easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
        complete: () => {
          rotatingRef.current = true;
          resolve();
        },
        cancel: () => {
          rotatingRef.current = true;
          resolve();
        },
      });
    });
  }, [clearPois]);

  const setPois = useCallback(
    (pois: GlobePoi[]) => {
      const dataSource = poiDataSourceRef.current;
      const Cesium = cesiumRef.current;
      const pinImages = pinImagesRef.current;
      if (!dataSource || !Cesium || !pinImages) return;
      clearPois();
      pois.forEach((poi, index) => {
        const spawnAt = performance.now() + index * POI_BURST_STAGGER_MS;
        const scaleProperty = new Cesium.CallbackProperty(() => {
          const t = Math.min(1, Math.max(0, (performance.now() - spawnAt) / POI_BURST_DURATION_MS));
          if (performance.now() < spawnAt) return 0;
          return Math.max(0, easeOutBack(t));
        }, false);
        const entity = dataSource.entities.add({
          id: `poi-${poi.key}`,
          position: Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat),
          billboard: {
            image: pinImages.default,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scale: scaleProperty,
          },
          label: {
            text: poi.name,
            font: "12px sans-serif",
            pixelOffset: new Cesium.Cartesian2(0, -36),
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.55),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        poiEntitiesRef.current.set(poi.key, entity);
      });
    },
    [clearPois]
  );

  const setHoveredPoi = useCallback((key: string | null) => {
    const Cesium = cesiumRef.current;
    const pinImages = pinImagesRef.current;
    if (!Cesium || !pinImages) return;
    for (const [k, entity] of poiEntitiesRef.current) {
      if (!entity.billboard) continue;
      const isHovered = k === key;
      // Cesium's Entity graphics are an imperative SDK object, not React state —
      // mutating them in place is how the SDK expects consumers to update a live scene.
      // eslint-disable-next-line react-hooks/immutability
      entity.billboard.image = new Cesium.ConstantProperty(
        isHovered ? pinImages.hovered : pinImages.default
      );
      entity.billboard.scale = new Cesium.ConstantProperty(isHovered ? 1.25 : 1.0);
    }
  }, []);

  /**
   * Averages the pixels in a small box (in CSS/client coordinates, e.g. from
   * getBoundingClientRect()) around the given point, for header-contrast
   * sampling. Draws the WebGL canvas onto an offscreen 2D canvas first —
   * a WebGL context can't run getImageData directly.
   */
  const sampleAverageColor = useCallback(
    (clientX: number, clientY: number, boxWidth = 40, boxHeight = 16) => {
      const viewer = viewerRef.current;
      if (!viewer) return null;
      const canvas = viewer.canvas as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const cx = Math.round((clientX - rect.left) * scaleX);
      const cy = Math.round((clientY - rect.top) * scaleY);
      const w = Math.max(1, Math.round(boxWidth * scaleX));
      const h = Math.max(1, Math.round(boxHeight * scaleY));
      const x = Math.max(0, Math.min(canvas.width - w, cx - Math.round(w / 2)));
      const y = Math.max(0, Math.min(canvas.height - h, cy - Math.round(h / 2)));
      if (x < 0 || y < 0 || w <= 0 || h <= 0) return null;

      if (!offscreenCanvasRef.current) {
        offscreenCanvasRef.current = document.createElement("canvas");
      }
      const off = offscreenCanvasRef.current;
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      try {
        ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        let r = 0;
        let g = 0;
        let b = 0;
        const pixelCount = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        return { r: r / pixelCount, g: g / pixelCount, b: b / pixelCount };
      } catch {
        // Cross-origin imagery tiles can taint the canvas in some browsers —
        // degrade to "no reading" rather than throwing.
        return null;
      }
    },
    []
  );

  return {
    ready,
    stopRotating,
    flyTo,
    panTo,
    resetToGlobalView,
    setPois,
    setHoveredPoi,
    clearPois,
    sampleAverageColor,
  };
}
