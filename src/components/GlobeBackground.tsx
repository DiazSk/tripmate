"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { HERO_VIEW, useMapCamera } from "@/lib/mapCamera";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { isGlobeHiddenRoute } from "@/lib/globeVisibility";
import GlobePoster from "@/components/GlobePoster";
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
 *
 * The 20km tier was split out of the old 2km–50km band for exactly that reason. A destination
 * flight lands at 15,000m *range* at -45°, which is ≈10.6km altitude — squarely inside that
 * band, and squarely a tilted close-up: at -45° the far half of the frame is the city you just
 * asked to see, and `dynamicScreenSpaceError` was coarsening precisely that. The band was also
 * carrying maximumScreenSpaceError 12, chosen for a view that reaches the horizon. So the
 * arrival view of a city was being served by the settings for looking at a region. Everything
 * above 20km keeps the old numbers, so wide multi-stop framings are unaffected.
 */
const LOD_TIERS = [
  // [ceiling in metres, maximumScreenSpaceError, dynamicScreenSpaceError]
  [2_000, 8, false],
  [20_000, 10, false],
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
  tileset: import("cesium").Cesium3DTileset,
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

/** How long the poster holds before revealing the canvas regardless. The reveal normally waits
 *  for Google's first tiles, which is the difference between fading into a city and fading into
 *  a blank blue sphere — but a stalled or rate-limited tile fetch must not strand the app on a
 *  poster that no longer matches where the camera has flown. */
const REVEAL_TIMEOUT_MS = 4000;

/**
 * The idle drift: 0.05 rad/s, a full turn in about two minutes — unchanged from the original
 * auto-rotation, so the landing page reads exactly as it did.
 *
 * What is different is *when* it runs. This used to be an unconditional loop for the tab's
 * lifetime, and a rotating camera renders every frame by definition, so it was the one thing
 * that could never coexist with `requestRenderMode`. It now runs only while the landing story's
 * reveal section is on screen (the one place on that route where the globe isn't behind an
 * opaque band), only in `static` mode, and never under `prefers-reduced-motion`. Off that
 * screen the globe is still and the GPU is idle.
 */
const SPIN_RATE_RAD_PER_S = 0.05;
/** Camera steps per second while drifting. Half the cost of stepping every frame. */
const SPIN_FPS = 30;
/** Ceiling on one integration step, in seconds — see the clamp in the spin effect. */
const MAX_SPIN_STEP_S = 0.1;

export default function GlobeBackground({
  creditClassName,
}: {
  creditClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const creditRef = useRef<HTMLDivElement>(null);
  const {
    setViewer,
    viewerRef,
    ready,
    globeMode,
    globeSpinning,
    activateGlobe,
    posterPlace,
  } = useMapCamera();
  const pathname = usePathname();
  /** Drives the cross-fade: false means the poster is what you are looking at. */
  const [canvasVisible, setCanvasVisible] = useState(false);

  const hidden = isGlobeHiddenRoute(pathname);
  /**
   * Cesium exists once a surface has asked for a globe of either kind (`static` or `live`) and
   * the route has something to show it through.
   *
   * A boolean, not the mode itself, and that is load-bearing: this is the mount effect's only
   * dependency, so promoting `static` → `live` when the CTA is pressed must not register as a
   * change here. Input handling is switched separately, below, on the viewer that already
   * exists — a rebuild would cost seconds of re-fetched tiles to change one flag.
   *
   * The globe used to be built on mount for every route and merely paused
   * (`useDefaultRenderLoop = false`) on a hidden one, which still paid for the dynamic `cesium`
   * import, the WebGL context and Google's tileset fetch before the pause could take effect.
   */
  const shouldMount = globeMode !== "off" && !hidden;

  useEffect(() => {
    if (!shouldMount) return;
    let viewer: import("cesium").Viewer | undefined;
    let cancelled = false;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      if (!containerRef.current) return;
      (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL =
        "/cesium/";
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
        /**
         * Render on demand, not on a clock.
         *
         * Cesium's default is a 60fps loop that redraws an identical frame for as long as the
         * page is open — on a stationary city overview that is a continuously busy GPU and a
         * measurably shorter battery for a picture that never changes. With this on, a frame is
         * drawn only when the scene actually changes: the camera moves, a tile lands, an entity
         * is added or restyled.
         *
         * `maximumRenderTimeChange: Infinity` removes the other trigger — by default Cesium
         * re-renders whenever the simulation clock has advanced past a threshold, which for a
         * scene with no time-varying anything (no sun-position animation, no CZML, no clocked
         * materials) is a redraw for nothing. Together these take a still camera to zero draw
         * calls per second.
         *
         * The cost is that anything changing the scene *without* moving the camera has to say
         * so: `requestRender()` in mapCamera covers entity adds, hover emphasis and the delayed
         * route-altitude correction, and `tileLoad` below covers streaming. Camera flights are
         * unaffected — their tween runs in `initializeFrame`, which is outside this gate, and
         * moving the camera requests its own frames.
         */
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
      });

      // Solid dark space behind/beyond the globe — not the default transparent canvas,
      // which would otherwise let the page background show through any gap. Read from
      // --canvas rather than repeating the literal: AppShell paints the same colour on the
      // DOM either side of this canvas, and if the two drift a seam appears at its edge.
      const canvasColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--canvas")
        .trim();
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(
        canvasColor || "#0b0f19",
      );

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
      let tileset: import("cesium").Cesium3DTileset | undefined;
      if (token) {
        try {
          tileset = await Cesium.createGooglePhotorealistic3DTileset();
          // Deactivation is now routine (every return to the landing page is one), so this
          // window — viewer built, tileset still in flight — is genuinely reachable. The
          // cleanup below has already run and saw no viewer to destroy, so it has to happen
          // here or the WebGL context leaks for the tab's lifetime.
          if (cancelled) {
            viewer?.destroy();
            return;
          }
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
          tileset.style = new Cesium.Cesium3DTileStyle({
            color: "color('#9BA6B4')",
          });
          tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.MIX;
          tileset.colorBlendAmount = 0.1;
          /**
           * Load the whole frame, not just the middle of it.
           *
           * Cesium defers tiles outside a narrow cone around the view centre (`foveatedConeSize`
           * 0.1) by *raising their screen-space error*, then waits `foveatedTimeDelay` — 0.2s by
           * default — after the camera stops before requesting them properly. That is a sound
           * optimization under a continuous render loop, and a trap under `requestRenderMode`:
           * a deferred tile satisfies the raised error, so `tilesLoaded` can report true, the
           * keep-alive stops asking for frames, and the delay never elapses in a rendered frame.
           * The periphery then stays coarse for good — a sharp patch in the middle of the screen
           * with a pixelated city around it.
           *
           * 0 means "request everything in this view now". `cullRequestsWhileMoving` (left on)
           * still suppresses requests that a moving camera would waste, so this costs requests
           * only where they are actually wanted: on a camera that has arrived and stopped.
           */
          tileset.foveatedTimeDelay = 0;
          viewer.scene.primitives.add(tileset);
          viewer.scene.globe.show = false;
          usingPhotorealistic = true;
          installLodController(viewer, tileset);
          // Hold the poster until there is a city under the camera rather than a blank sphere.
          tileset.initialTilesLoaded.addEventListener(() => setCanvasVisible(true));
        } catch {
          usingPhotorealistic = false;
        }
      }
      if (!usingPhotorealistic) {
        viewer.imageryLayers.addImageryProvider(
          new Cesium.OpenStreetMapImageryProvider({
            url: "https://tile.openstreetmap.org/",
          }),
        );
      }

      /**
       * Keep drawing for as long as the view is still resolving, then stop dead.
       *
       * Refinement is a multi-frame conversation, not one request: a frame traverses the tree,
       * asks for the tiles that meet the current screen-space error, and only the *next* frame
       * can ask for the level below that once the parents have landed. A 60fps loop hid this
       * completely — the traversal simply ran forever, so a view always reached full detail.
       *
       * Under `requestRenderMode` the conversation has to be kept alive deliberately, and doing
       * it per-arriving-tile (`tileset.tileLoad`) was not enough: that chain has to be unbroken
       * to survive, and any gap in it — a request that errors, a frame whose traversal is
       * waiting on a parent and asks for nothing, `skipLevelOfDetail` jumping levels — ends it
       * permanently, because with the camera stopped nothing exists to start it again. What
       * that looked like was a stop you had just flown to sitting at whatever coarse level
       * happened to be loaded when the flight ended, and staying there.
       *
       * `tilesLoaded` is the honest predicate: "all tiles that meet the screen space error this
       * frame are loaded". It cannot stall, because it is re-read every frame rather than
       * chained off an event, and it goes false again by itself whenever the LOD controller
       * raises the detail ceiling or the camera lands somewhere new. This is the one thing in
       * the scene allowed to hold the GPU, and it holds it for exactly as long as the picture
       * is still arriving — which is the cost the old always-on loop paid permanently.
       */
      const keepRenderingWhileResolving = () => {
        // Only ask the surface that is actually drawing. `globe.show` is false on the
        // photorealistic path, and a hidden globe is not updated — reading its `tilesLoaded`
        // there risks a predicate that never becomes true, i.e. a render loop that never ends,
        // which is the exact failure this whole change exists to remove.
        const resolving = usingPhotorealistic
          ? !!tileset && !tileset.tilesLoaded
          : !viewer!.scene.globe.tilesLoaded;
        if (resolving) viewer!.scene.requestRender();
      };
      viewer.scene.postRender.addEventListener(keepRenderingWhileResolving);

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
        destination: Cesium.Cartesian3.fromDegrees(
          HERO_VIEW.lng,
          HERO_VIEW.lat,
          HERO_VIEW.height,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(HERO_VIEW.headingDeg),
          pitch: Cesium.Math.toRadians(HERO_VIEW.pitchDeg),
          roll: 0,
        },
      });

      /*
       * The idle auto-rotation that used to live here is gone.
       *
       * It existed for one screen — the landing hero — and it was the single most expensive
       * thing the app did: rotating the camera every frame means the scene is never still, so
       * it defeats `requestRenderMode` outright (a moved camera always redraws) *and* keeps
       * Google's tile traversal re-evaluating for a globe nobody had asked to look at yet. The
       * landing page is now a poster (GlobePoster), so there is no screen left that wants a
       * spinning globe: by the time this viewer exists, the user has asked to go somewhere
       * specific, and a flight is already on its way.
       */

      // Dev-only handle for inspecting the scene from the console or a browser-automation
      // probe: entity counts after a day switch, camera pose, tile detail. Nothing else
      // reaches the viewer — it lives in a closure here and in a ref in mapCamera — and the
      // route geometry is only verifiable by counting what is actually in the collection.
      // Stripped from production builds by the NODE_ENV check.
      if (process.env.NODE_ENV === "development") {
        const w = window as Window & {
          __tripmateViewer?: unknown;
          __tripmateCesium?: unknown;
        };
        w.__tripmateViewer = viewer;
        // The module too, so a probe can build a BoundingSphere or HeadingPitchRange and check
        // the framing instantly. Cesium is only ever reached through a dynamic import here, so
        // there is otherwise no handle on its classes from outside a module scope.
        w.__tripmateCesium = Cesium;
      }

      setViewer(viewer);
      // Without a photorealistic tileset there is nothing to stream and nothing to wait for, so
      // the fallback OSM imagery can come straight in.
      if (!usingPhotorealistic) setCanvasVisible(true);
      revealTimer = setTimeout(() => setCanvasVisible(true), REVEAL_TIMEOUT_MS);
    })();

    return () => {
      cancelled = true;
      clearTimeout(revealTimer);
      if (process.env.NODE_ENV === "development") {
        // Otherwise a console or probe reads a handle to a destroyed viewer and gets
        // `isDestroyed()` errors that look like scene bugs.
        const w = window as Window & {
          __tripmateViewer?: unknown;
          __tripmateCesium?: unknown;
        };
        w.__tripmateViewer = undefined;
      }
      // Back to the poster before the canvas goes, so the fade out runs over a still-painted
      // scene rather than over the bare page background.
      setCanvasVisible(false);
      setViewer(null);
      viewer?.destroy();
    };
    // `setViewer` is stable (a useCallback over stable callbacks) and deliberately left out:
    // it is not a reason to rebuild a viewer, and rebuilding one is seconds of tile fetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldMount]);

  // The idle drift, restored — but scoped, capped and reduced-motion-aware rather than the
  // unconditional 60fps loop it used to be. See SPIN_RATE_RAD_PER_S above.
  useEffect(() => {
    if (!ready || !globeSpinning || globeMode !== "static") return;
    if (prefersReducedMotion()) return;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    let frame = 0;
    let cancelled = false;
    let last = performance.now();
    let lastStep = 0;

    import("cesium").then((Cesium) => {
      if (cancelled || viewer.isDestroyed()) return;
      const tick = (now: number) => {
        frame = requestAnimationFrame(tick);
        // Cadence cap. rAF still runs at display rate, but the *camera* only moves at SPIN_FPS,
        // and a frame is only drawn when the camera moves — so this halves the GPU cost against
        // rotating every frame, for a difference nobody can see: at 2.9°/s a 30fps step is 0.1°.
        if (now - lastStep < 1000 / SPIN_FPS) return;
        // Clamped, and load-bearing. rAF stops in a background tab, so `now - last` can be
        // minutes on return; integrating that raw would snap the globe through everything it
        // "missed" while nobody was watching. The clamp turns a resumed tab into one ordinary
        // step — the previous implementation needed an explicit timestamp reset for the same
        // hazard and still didn't cover the background-tab case.
        const delta = Math.min((now - last) / 1000, MAX_SPIN_STEP_S);
        last = now;
        lastStep = now;
        viewer.scene.camera.rotate(
          Cesium.Cartesian3.UNIT_Z,
          -SPIN_RATE_RAD_PER_S * delta,
        );
        // No requestRender: moving the camera is itself a render trigger
        // (`checkForCameraUpdates` in Scene.render), so asking again would be redundant.
      };
      frame = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [globeSpinning, globeMode, ready, viewerRef]);

  // `static` vs `live` is exactly this one flag. Separate from the mount effect so the promotion
  // happens on the viewer that is already up, and keyed on `ready` as well as the mode because
  // the viewer usually registers *after* the mode that asked for it was set.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || viewer.isDestroyed()) return;
    // Parked, not frozen: the camera can still be flown programmatically (that is what a
    // destination flight is), but the hero globe cannot be dragged, zoomed or tilted by hand.
    // Without this, a wheel event anywhere over the landing page's own scroll gaps would zoom
    // the Earth — and, worse for the battery, wake the render loop for as long as it took the
    // inertia to settle.
    viewer.scene.screenSpaceCameraController.enableInputs =
      globeMode === "live";
  }, [globeMode, ready, viewerRef]);

  return (
    <>
      {/* No poster on a globe-hidden route: those pages are fully opaque, so it would only
          fetch a photo nobody can see. */}
      {!hidden && (
        <GlobePoster
          place={posterPlace}
          visible={!canvasVisible}
          // Offered only while there is genuinely no viewer — once one is coming up (static or
          // live) the button would re-arm something that is already building.
          onActivate={globeMode === "off" ? activateGlobe : undefined}
        />
      )}
      {/* Absolute rather than in flow so it stacks over the poster instead of below it.
          Cross-fades in once there is something worth looking at (see setCanvasVisible). */}
      <div
        ref={containerRef}
        className="absolute inset-0 transition-opacity duration-300"
        style={{ opacity: canvasVisible ? 1 : 0 }}
      />
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
