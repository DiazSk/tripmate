"use client";

import { useEffect, useRef } from "react";
import { useMapCamera } from "@/lib/mapCamera";
import "cesium/Build/Cesium/Widgets/widgets.css";

export default function GlobeBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
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

      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(0, 20, 20000000),
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

  return <div ref={containerRef} className="h-full w-full" />;
}
