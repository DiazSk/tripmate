"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useMapCamera } from "@/lib/mapCamera";
import { isGlobeHiddenRoute } from "@/lib/globeVisibility";
import "cesium/Build/Cesium/Widgets/widgets.css";

/**
 * Detail tiers, chosen by how high the camera is.
 *
 * A single `maximumScreenSpaceError` does NOT mean a single real-world detail level: Google's
 * tile tree is structured differently per region, so Cesium's default of 16 resolves to 8m
 * geometry in Frankfurt and 16m — one whole LOD level shallower — in Mumbai. Measured at an
 * identical pose (900m, -35°), that was 166k triangles against 21k, which is why Mumbai's
 * buildings read as flat roofs with smeared edges while Frankfurt's read as buildings. The
 * deeper Mumbai tiles existed the whole time; nothing was asking for them.
 *
 * So the ceiling is bought where it is legible and nowhere else. Boundaries come from this
 * app's own camera targets: `flyToPlace` is a 600m range at -35° (≈344m up), `flyToDestination`
 * is 15,000m at -45° (≈10.6km), and HERO_VIEW is a true 2,500km altitude.
 *
 * `dynamicScreenSpaceError` inflates the allowed error with distance from the camera, which is
 * a real saving on a horizon-filling view and a liability on a tilted close-up where much of
 * the frame is "far". It rides the same tier.
 */
const LOD_TIERS = [
  // [ceiling in metres, maximumScreenSpaceError, dynamicScreenSpaceError]
  [2_000, 8, false],
  [50_000, 12, true],
  [Infinity, 16, true],
] as const;

/**
 * Applies the tier for the camera's current height, once per change.
 *
 * Runs on `preRender` rather than `camera.changed`: the latter needs a `percentageChanged`
 * threshold and can miss a programmatic `setView`, and this is a float read plus two
 * comparisons — cheaper than the bookkeeping to fire it less often. Only the *transition*
 * writes to the tileset, so a steady camera costs nothing and tile traversal isn't disturbed.
 */
function installLodController(
  viewer: import("cesium").Viewer,
  tileset: import("cesium").Cesium3DTileset
) {
  let applied = -1;
  viewer.scene.preRender.addEventListener(() => {
    const height = viewer.camera.positionCartographic.height;
    const tier = LOD_TIERS.findIndex(([ceiling]) => height < ceiling);
    if (tier === applied) return;
    applied = tier;
    const [, sse, dynamic] = LOD_TIERS[tier];
    tileset.maximumScreenSpaceError = sse;
    tileset.dynamicScreenSpaceError = dynamic;
  });
}

export default function GlobeBackground({ creditClassName }: { creditClassName?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const creditRef = useRef<HTMLDivElement>(null);
  const { setViewer } = useMapCamera();
  const pathname = usePathname();
  const viewerInstanceRef = useRef<import("cesium").Viewer | null>(null);

  // Separate from the mount effect below (which runs once): this reacts to route changes on the
  // one already-constructed viewer, rather than tearing down and rebuilding the whole globe.
  useEffect(() => {
    const viewer = viewerInstanceRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const hidden = isGlobeHiddenRoute(pathname);
    // Stops the render loop entirely rather than just hiding the canvas — with it running,
    // Cesium keeps re-rendering the (Google photorealistic, tile-streaming) scene and ticking
    // the auto-rotate spin every frame regardless of whether anything is drawn on top of it.
    viewer.useDefaultRenderLoop = !hidden;
  }, [pathname]);

  useEffect(() => {
    let viewer: import("cesium").Viewer | undefined;
    let cancelled = false;
    let spinListener: (() => void) | undefined;
    let pauseSpin: (() => void) | undefined;
    let resumeSpin: (() => void) | undefined;

    (async () => {
      if (!containerRef.current) return;
      // Skip booting Cesium at all when landing directly on a globe-hidden route (today, only
      // `/backend`, reached and left exclusively via typed URLs / hard loads — it has no inbound
      // or outbound links to the rest of the app, so there's no soft-navigation path where this
      // would ever need to construct late). Pausing the render loop (the effect above) still
      // matters for a page that arrives here from a soft nav with the globe already live, but a
      // cold load pays for the dynamic `cesium` import, the WebGL context, and Google's
      // photorealistic tileset fetch *before* that pause ever takes effect — this skips all of
      // it up front instead.
      if (isGlobeHiddenRoute(pathname)) return;
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
      // which would otherwise let the page background show through any gap. Read from
      // --canvas rather than repeating the literal: AppShell paints the same colour on the
      // DOM either side of this canvas, and if the two drift a seam appears at its edge.
      const canvasColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--canvas")
        .trim();
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(canvasColor || "#0b0f19");

      // Everything else on the camera controller stays at Cesium's defaults — the map is
      // meant to be freely draggable/zoomable/tiltable. These two just stop the extremes:
      // below ~50m you're inside the photorealistic building mesh, and the ceiling has to stay
      // above the 2,500km hero altitude or resetToHome's flight fights the clamp.
      viewer.scene.screenSpaceCameraController.minimumZoomDistance = 50;
      viewer.scene.screenSpaceCameraController.maximumZoomDistance = 25_000_000;

      // Render at the display's real pixel density instead of CSS pixels. Cesium's default
      // (`useBrowserRecommendedResolution: true`) ignores devicePixelRatio, so on any scaled
      // display the canvas is upscaled and building edges go soft no matter how good the mesh
      // underneath is. Capped at 2x because fill cost grows with the square of the ratio and a
      // 3x phone would otherwise render 9x the pixels for detail nobody can resolve. This is a
      // no-op at devicePixelRatio 1.
      const dpr = window.devicePixelRatio || 1;
      viewer.useBrowserRecommendedResolution = false;
      viewer.resolutionScale = Math.min(dpr, 2) / dpr;

      let usingPhotorealistic = false;
      if (token) {
        try {
          const tileset = await Cesium.createGooglePhotorealistic3DTileset();
          if (cancelled) return;
          // Google's tiles ship at full satellite vibrance, which reads harsh against the
          // Apple Maps look this design targets. Blending each tile toward a cool grey pulls
          // saturation down. This has to happen on the tileset rather than as a CSS filter
          // over the canvas: a canvas filter would also desaturate the route overlay, and
          // pure blue can't survive a round trip through one — #0A84FF comes out as
          // rgb(36,135,234).
          //
          // 0.1, halved from 0.2: MIX toward a *mid* grey pulls highlights down and shadows up
          // at the same time, so it crushes contrast, not just saturation. Frankfurt's imagery
          // is contrasty enough to absorb that; Mumbai's is hazy and low-contrast to begin
          // with, and the same blend read as mud — structures stopped separating from each
          // other. Half the amount keeps the cool register and returns the contrast.
          tileset.style = new Cesium.Cesium3DTileStyle({ color: "color('#9BA6B4')" });
          tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.MIX;
          tileset.colorBlendAmount = 0.1;
          viewer.scene.primitives.add(tileset);
          viewer.scene.globe.show = false;
          usingPhotorealistic = true;
          installLodController(viewer, tileset);
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

      // The counterpart, for returning to the landing page. Without it `locked` is never written
      // back, so the first flight of the session kills the idle spin for the tab's lifetime —
      // a soft navigation home would sit still where a hard reload spins.
      (viewer as import("cesium").Viewer & { startAutoRotate?: () => void }).startAutoRotate =
        () => {
          locked = false;
          rotating = true;
          // Load-bearing: spinListener integrates (now - lastTime), so resuming without this
          // snaps the globe through however long the spin was paused.
          lastTime = Date.now();
        };

      viewerInstanceRef.current = viewer;
      // Always true here: reaching this line already means the early `isGlobeHiddenRoute` return
      // above didn't fire, i.e. the current route wants the globe running.
      viewer.useDefaultRenderLoop = true;
      setViewer(viewer);
    })();

    return () => {
      cancelled = true;
      viewerInstanceRef.current = null;
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
