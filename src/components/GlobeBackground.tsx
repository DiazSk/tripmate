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

    (async () => {
      if (!containerRef.current) return;
      (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium/";
      const Cesium = await import("cesium");
      if (cancelled || !containerRef.current) return;

      const token = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
      if (token) Cesium.Ion.defaultAccessToken = token;

      viewer = new Cesium.Viewer(containerRef.current, {
        // Google's terms require the attribution stay visible, and Cesium's default
        // bottom-left placement lands under the hero seam where it would be covered.
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

      // Hero framing: the curved limb with space above it, rather than the whole disc. At
      // 2,500km the horizon sits acos(R/(R+h)) = 44.1° below local horizontal, so pitching
      // just past it puts the curve slightly above frame centre. NOTE this is a true
      // altitude — unlike mapCamera's flyTo, whose height argument is a HeadingPitchRange
      // *range*.
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(8, 22, 2_500_000),
        orientation: {
          heading: Cesium.Math.toRadians(5),
          pitch: Cesium.Math.toRadians(-46),
          roll: 0,
        },
      });

      setViewer(viewer);
    })();

    return () => {
      cancelled = true;
      setViewer(null);
      viewer?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      {/* Attribution has to stay visible (Google's terms) without covering the content that
          overlaps the globe, so the shell decides where it goes per layout. */}
      <div ref={creditRef} className={`z-30 max-w-[85%] leading-tight ${creditClassName ?? ""}`} />
    </>
  );
}
