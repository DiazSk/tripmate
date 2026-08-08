"use client";

import { useEffect, useRef } from "react";
import { useMapCamera } from "@/lib/mapCamera";
import "cesium/Build/Cesium/Widgets/widgets.css";

export default function GlobeBackground({ creditClassName }: { creditClassName?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const creditRef = useRef<HTMLDivElement>(null);
  const { setViewer } = useMapCamera();

  useEffect(() => {
    let viewer: import("cesium").Viewer | undefined;
    let cancelled = false;
    let spinListener: (() => void) | undefined;
    let pauseSpin: (() => void) | undefined;
    let resumeSpin: (() => void) | undefined;

    (async () => {
      if (!containerRef.current) return;
      (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium/";
      const Cesium = await import("cesium");
      if (cancelled || !containerRef.current) return;

      const token = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
      if (token) Cesium.Ion.defaultAccessToken = token;

      viewer = new Cesium.Viewer(containerRef.current, {
        // Google's terms require the attribution stay visible, so it's redirected to our
        // own positioned container rather than Cesium's default bottom-left placement.
        // This can only be set at construction time.
        creditContainer: creditRef.current ?? undefined,
        timeline: false,
        animation: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        baseLayer: false,
      });

      // Solid dark space behind/beyond the globe — not the default transparent canvas,
      // which would otherwise let the page's cream background show through any gap.
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0b0f19");

      let usingPhotorealistic = false;
      if (token) {
        try {
          const tileset = await Cesium.createGooglePhotorealistic3DTileset();
          if (cancelled) return;
          viewer.scene.primitives.add(tileset);
          viewer.scene.globe.show = false;
          usingPhotorealistic = true;
        } catch {
          usingPhotorealistic = false;
        }
      }
      if (!usingPhotorealistic) {
        viewer.imageryLayers.addImageryProvider(
          new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })
        );
      }

      // Hero framing: horizon roughly at frame centre, so the curve sits around
      // 45-50% down the screen (space above for the header/card, Earth below). At
      // 2,500km the horizon sits acos(R/(R+h)) = 44.1° below local horizontal, and
      // pitch -44.1° is exactly "boresight pointed at the horizon" i.e. frame centre —
      // this is why -44/-45 lands the curve near centre regardless of viewport aspect
      // ratio, whereas a much shallower pitch (e.g. -20 to -30°) would aim the
      // boresight *above* the horizon and push it out of frame entirely (all space,
      // no visible curve). NOTE altitude here is a true altitude — unlike
      // mapCamera's flyTo, whose height argument is a HeadingPitchRange *range*.
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(8, 22, 2_500_000),
        orientation: {
          heading: Cesium.Math.toRadians(5),
          pitch: Cesium.Math.toRadians(-45),
          roll: 0,
        },
      });

      // Continuous slow auto-rotation, paused while the user is actively dragging/
      // touching the globe and resumed after release. `draggingFromCanvas` (not just
      // "rotating") gates resume, because pointerup is tracked on window (so a drag
      // that ends off-canvas still resumes) — without it, releasing a click on any
      // other UI (e.g. the "Choose your style" button) would also resume rotation,
      // fighting with whatever flyTo that button just triggered. `locked` is set once
      // a destination is actually chosen (see stopAutoRotate below) and, unlike a
      // drag pause, is never auto-resumed.
      let rotating = true;
      let locked = false;
      let draggingFromCanvas = false;
      let lastTime = Date.now();
      spinListener = () => {
        if (!rotating) {
          lastTime = Date.now();
          return;
        }
        const now = Date.now();
        const delta = (now - lastTime) / 1000;
        lastTime = now;
        viewer!.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.05 * delta);
      };
      pauseSpin = () => {
        draggingFromCanvas = true;
        rotating = false;
      };
      resumeSpin = () => {
        if (draggingFromCanvas && !locked) {
          rotating = true;
          lastTime = Date.now();
        }
        draggingFromCanvas = false;
      };
      viewer.scene.postRender.addEventListener(spinListener);
      viewer.scene.canvas.addEventListener("pointerdown", pauseSpin);
      window.addEventListener("pointerup", resumeSpin);

      // Exposed on the viewer so code elsewhere holding the same viewer instance
      // (mapCamera's flyTo, triggered once a destination is chosen) can permanently
      // stop the spin — flying toward a specific place while the globe keeps
      // spinning under it makes no sense.
      (viewer as import("cesium").Viewer & { stopAutoRotate?: () => void }).stopAutoRotate = () => {
        locked = true;
        rotating = false;
      };

      setViewer(viewer);
    })();

    return () => {
      cancelled = true;
      setViewer(null);
      if (viewer) {
        if (spinListener) viewer.scene.postRender.removeEventListener(spinListener);
        if (pauseSpin) viewer.scene.canvas.removeEventListener("pointerdown", pauseSpin);
      }
      if (resumeSpin) window.removeEventListener("pointerup", resumeSpin);
      viewer?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      {/* Visually hidden per request — NOTE: Google's Photorealistic 3D Tiles terms of
          service require this attribution to stay visible when those tiles are in use
          (see the token check above). Re-enable if shipping with a live Ion token. */}
      <div
        ref={creditRef}
        className={`hidden z-30 max-w-[85%] leading-tight ${creditClassName ?? ""}`}
      />
    </>
  );
}
