"use client";

import { useEffect, useRef, useState } from "react";
import { useMapCamera } from "@/lib/mapCamera";
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

/** How long the globe sits untouched before the idle drift starts easing out, and how long that
 *  ease takes. Together they bound how long the scene keeps repainting after the last
 *  interaction — past that the canvas goes quiet and every glass panel over it stops re-blurring.
 *  Long enough that the drift still reads as "alive" on arrival; short enough that a page left
 *  open costs nothing. */
const SPIN_IDLE_AFTER_MS = 4_000;
const SPIN_EASE_OUT_MS = 2_500;

/** Ceiling on the device-pixel ratio the scene renders at — see the `resolutionScale` comment
 *  below for the measurement behind 1.5. */
const MAX_RENDER_PIXEL_RATIO = 1.5;

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
  const { setViewer, globeWanted, ready } = useMapCamera();
  const viewerInstanceRef = useRef<import("cesium").Viewer | null>(null);

  /**
   * One-way latch on `globeWanted`, and the only dependency of the construction effect below.
   *
   * One-way because **a viewer swap is unrecoverable.** `viewer.destroy()` takes the camera pose,
   * the 512MB tile cache and every `viewer.entities` — route arcs, stems, glow pools, the
   * destination pin — and nothing replays them: `showDayRoute` is a `useCallback(…, [])` whose
   * only caller (ItineraryCard's effect, deps `[day, showDayRoute]`) sees neither dep change on a
   * swap, and `setViewer`'s pending queues were consumed and nulled on the first registration.
   * So the globe is built at most once per mount of this component, and torn down only when this
   * component genuinely unmounts — which it never does, since AppShell renders it from the root
   * layout.
   *
   * Depending on `globeWanted` directly would be wrong for exactly that reason: React runs the
   * cleanup on every dep change, so leaving a globe surface would destroy the viewer.
   */
  const [built, setBuilt] = useState(false);
  // Adjusted during render rather than in an effect — React's documented pattern for deriving
  // state from a changed input, and the same in-render adjustment GenerationLoader already uses
  // for its caption index. An effect would be a cascading render, and `react-hooks/set-state-in-
  // effect` rejects it outright.
  if (globeWanted && !built) setBuilt(true);

  // Separate from the construction effect below (which runs once): this reacts to the gate on the
  // one already-constructed viewer, rather than tearing down and rebuilding the whole globe.
  useEffect(() => {
    const viewer = viewerInstanceRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    // Stops the render loop entirely rather than just hiding the canvas — with it running,
    // Cesium keeps re-rendering the (Google photorealistic, tile-streaming) scene and ticking
    // the auto-rotate spin every frame regardless of whether anything is drawn on top of it.
    viewer.useDefaultRenderLoop = globeWanted;
    // Under requestRenderMode, restarting the loop is not by itself enough to draw anything —
    // it renders on demand, and arriving back from a hidden route is a demand nothing else
    // signals. One frame is all it needs; the idle logic takes it from there.
    if (globeWanted) viewer.scene.requestRender();
    // `ready` is in the deps and is not decoration: it flips exactly when `setViewer` lands, so
    // this re-runs the moment the viewer registers and applies whatever the gate says *then*.
    // Without it, a gate that closed mid-construction — a generation cancelled during the ~5s
    // import — would leave Cesium's own constructor default of a live render loop running on a
    // hidden canvas, because this effect's own deps would not have changed.
  }, [globeWanted, ready]);

  useEffect(() => {
    let viewer: import("cesium").Viewer | undefined;
    let cancelled = false;
    let spinListener: (() => void) | undefined;
    let pauseSpin: (() => void) | undefined;
    let resumeSpin: (() => void) | undefined;
    let wakeSpin: (() => void) | undefined;

    (async () => {
      if (!built || !containerRef.current) return;
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
        // Render on demand instead of on every rAF tick. Cesium's default is a continuous loop
        // that re-renders the whole photorealistic tileset at display refresh (measured ~160fps
        // here) whether or not anything changed — and because every glass panel in this app is a
        // `backdrop-filter` sibling sitting directly over this canvas, a canvas that repaints
        // every frame forces each of those panels to re-sample and re-blur its backdrop every
        // frame too. That coupling, not the globe alone, is what made the whole UI feel stuck.
        //
        // Cesium re-renders by itself on camera movement, tile loads and property changes, so
        // interaction and flights are unaffected. What stops is the idle case.
        requestRenderMode: true,
        // Never re-render merely because the simulation clock advanced: nothing in this scene is
        // driven by Cesium time (no sun/lighting animation). The route dash shimmer reads
        // `performance.now()` from a CallbackProperty, which is evaluated only on frames that
        // actually render — so it animates whenever the scene is awake and settles with the rest
        // of it when the scene is not, which is the intended behaviour rather than a casualty.
        maximumRenderTimeChange: Infinity,
      });

      // Ceiling for the frames that *do* render. On a high-refresh display the uncapped loop was
      // spending 160fps of full tileset draw on a scene whose fastest motion is a slow drift;
      // 60 is the smoothness bar for dragging and costs under half as much.
      viewer.targetFrameRate = 60;

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

      // Render above CSS pixel density, but not all the way to the display's. Cesium's default
      // (`useBrowserRecommendedResolution: true`) ignores devicePixelRatio entirely, so on a
      // scaled display the canvas is upscaled and building edges go soft no matter how good the
      // mesh underneath is. Fill cost grows with the square of the ratio, hence a cap.
      //
      // The cap is 1.5, lowered from 2 against a measurement rather than a guess. On a 2x /
      // 160Hz Windows display the 2x cap produced a 3204x2654 canvas — 8.5 megapixels, larger
      // than a 4K framebuffer — and a moving camera sustained only 33.7 painted fps against a
      // 60 target, i.e. squarely fill-rate bound. 1.5 cuts that to ~4.8 megapixels (-44%), which
      // predicts ~60 fps, and it costs sharpness only on displays above 1.5x while still
      // rendering well above the CSS-pixel default this exists to beat. Every backdrop-filter
      // panel over the canvas samples the same device pixels, so this is also the one knob that
      // scales the glass blurs. No-op at devicePixelRatio 1.
      const dpr = window.devicePixelRatio || 1;
      viewer.useBrowserRecommendedResolution = false;
      viewer.resolutionScale = Math.min(dpr, MAX_RENDER_PIXEL_RATIO) / dpr;

      let usingPhotorealistic = false;
      if (token) {
        try {
          const tileset = await Cesium.createGooglePhotorealistic3DTileset();
          // Destroys rather than just returning. The cleanup at the bottom of this effect closes
          // over `viewer`, and by the time an unmount can land *here* that cleanup has already
          // run — with `viewer` still undefined, because it is only assigned after the earlier
          // `await import("cesium")` resolves. So a bare `return` orphans a live WebGL context
          // and its whole tile cache. Not reachable from Strict Mode's double-invoke (that
          // unmount lands before the import resolves, and the guard up there catches it), but
          // every Fast Refresh during a tileset load hits it — and Chrome caps live contexts and
          // starts killing the oldest, which presents as "the globe went black in dev".
          if (cancelled) {
            viewer.destroy();
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
          tileset.style = new Cesium.Cesium3DTileStyle({ color: "color('#9BA6B4')" });
          tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.MIX;
          tileset.colorBlendAmount = 0.1;

          // Draw the coarse ancestor immediately instead of waiting for the whole chain down to
          // the target detail. `createGooglePhotorealistic3DTileset` leaves this false.
          //
          // The reason is what the *first two seconds* look like, which is when a visitor forms
          // their opinion. Measured over a scripted arrival at 400m on Prague, with the `true` case
          // handicapped by running first on a cold HTTP cache while `false` got the warm one:
          //
          //   t=2s   skipLOD true: 84,971 triangles — a legible city, roofs and streets
          //          skipLOD false: 8,494 triangles — an empty grey void
          //   t=12s  visually indistinguishable; 0.84% mean pixel difference across the frame
          //
          // It also loads far less: re-measured in this file's *shipped* configuration (the request
          // cap above, 512MB cache) over pans across four cities nobody had visited, tile loads per
          // pan fell from 38/137 to 16/21, and the largest burst in a single frame from 4-5 tiles to
          // 1-2. Burst size is the thing that sets frame time here (see the request-cap note), so
          // this compounds with that cap rather than duplicating it.
          //
          // It is **not** a throughput win any more, and that is worth knowing before anyone cites
          // the old number: painted fps is 36.4/36.5 against 37.5/35.8, i.e. identical. An earlier
          // +22% (39.4 -> 48.1) predates the request cap, and capping concurrency has since taken
          // that headroom.
          //
          // Settled detail does not suffer. Same city, same pose, fully settled: 0.65% mean pixel
          // difference between on and off — an indistinguishable frame, which is the evidence that
          // actually matters. Triangle counts agree (649k from 890 tiles against 431k from 839) but
          // are the weaker signal: DESIGN.md's "judge globe detail by minimum geometric error, not
          // triangle count" applies, and ignoring it is how a four-city sample first appeared to
          // show detail *dropping* — mesh density per declared error is Google's data and varies by
          // region, so cross-city counts compare regions rather than settings.
          //
          // The documented risk is popping between levels, and it is real but transient: a coarse
          // wedge survived to 12s on a cold run (12.9% of that corner's pixels differing from the
          // settled reference) and was gone warm (1.4%). Since the alternative at that moment is a
          // blank viewport, approximate geometry that sharpens is the better failure.
          tileset.skipLevelOfDetail = true;

          // Two different stalls live here, and they want opposite things — which is why this
          // is conditional rather than one global number.
          //
          // Cesium finalizes *every* tile that became ready during a frame, in that frame, with
          // no per-frame budget and no public API to add one. Finalize is main-thread work
          // (glTF finish + GPU upload) at very roughly 1.8ms a tile, so frame time is set by how
          // many tiles land *together*, and that burst is bounded by how many requests are in
          // flight to the single server Google serves from — 18 once its tileset helper has run,
          // against Cesium's own default of 6.
          //
          // How big those bursts get scales with how many pixels are being filled, so the fix
          // does too. Measured with a scripted lateral pan at 400m over cities the session had
          // never visited:
          //
          //   3.58MP canvas (laptop, 2520x1422): bursts reach 14 tiles/frame at 18. Capping to
          //   6 takes the worst frame from 257/330ms to 39-78ms across six cities, sustained fps
          //   unchanged. This is a large, obvious win.
          //
          //   1.5MP canvas (1000x720 desktop window): bursts reach only 4-7 either way, and the
          //   cap is a no-op — worst frame 66/46ms at 18 against 69/50ms at 6, inside noise.
          //
          //   0.65MP canvas (iPhone 16 Pro, 603x1071): bursts never exceed 8 at *either* limit,
          //   because a small viewport simply never asks for that many tiles at once. There is
          //   nothing for the cap to clip, so all it does is starve the pipeline — worst frame
          //   goes the wrong way, 37/46ms at 18 against 51/73/109ms at 6.
          //
          // So the threshold sits above the size where the cap stops paying (and starts costing)
          // and below the size where it pays enormously; 2MP is between the 1.5 and 3.58 that
          // were actually measured, not a round number picked for looks. Evaluated once at
          // construction: a window resize or an orientation change will not re-pick, which is
          // the accepted cost of not re-tuning a global scheduler mid-drag.
          const renderMegapixels =
            (viewer.scene.drawingBufferWidth * viewer.scene.drawingBufferHeight) / 1e6;
          if (renderMegapixels > 2) {
            Cesium.RequestScheduler.maximumRequestsPerServer = 6;
          }

          // The phone's actual problem, and a different one: Google's helper leaves the tile
          // cache at 1.5GB, and this scene fills it — ~1.39GB of resident textures over a few
          // cities. On a real iPhone that is enough for iOS to discard the tab outright; it was
          // caught mid-measurement, with `performance.getEntriesByType("navigation")[0].type`
          // coming back `back_forward` on a page nobody had navigated. 512MB holds ~447MB of
          // textures instead, costs nothing measurable on either device (laptop fps 39.4 -> 40.9
          // at the same settings), and on the phone is the difference between a 311-417ms worst
          // frame and 37-109ms. It is not a stall fix on desktop — it moved the laptop's worst
          // frame by 3ms — it is a memory-headroom fix that happens to matter enormously where
          // memory is scarce.
          tileset.cacheBytes = 512 * 1024 * 1024;

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
      let lastInteraction = Date.now();

      /**
       * Wakes the scene.
       *
       * Load-bearing under `requestRenderMode`: `postRender` only fires on frames that actually
       * rendered, so once the drift has eased out and stopped asking for frames, `spinListener`
       * can no longer restart itself. Every path back into motion has to go through here.
       */
      const wake = () => {
        lastInteraction = Date.now();
        lastTime = lastInteraction;
        if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
      };

      spinListener = () => {
        if (!rotating) {
          lastTime = Date.now();
          return;
        }
        const now = Date.now();
        const delta = (now - lastTime) / 1000;
        lastTime = now;
        // Ease the drift to a standstill once the user has been idle, rather than cutting it:
        // an abrupt stop reads as a stall. Squared so the last few degrees are the gentlest.
        // When `remaining` reaches 0 this returns *without* requesting another frame, and the
        // canvas — along with every backdrop-filter panel sampling it — stops repainting.
        const idleFor = now - lastInteraction;
        const remaining =
          1 - Math.min(1, Math.max(0, idleFor - SPIN_IDLE_AFTER_MS) / SPIN_EASE_OUT_MS);
        if (remaining <= 0) return;
        viewer!.scene.camera.rotate(
          Cesium.Cartesian3.UNIT_Z,
          -0.05 * delta * remaining * remaining
        );
        viewer!.scene.requestRender();
      };
      pauseSpin = () => {
        draggingFromCanvas = true;
        rotating = false;
      };
      resumeSpin = () => {
        if (draggingFromCanvas && !locked) {
          rotating = true;
          wake();
        }
        draggingFromCanvas = false;
      };
      viewer.scene.postRender.addEventListener(spinListener);
      viewer.scene.canvas.addEventListener("pointerdown", pauseSpin);
      // Zoom is the one globe interaction that never goes through pointerdown/pointerup, so it
      // would otherwise leave the drift eased-out while the user is plainly still using the map.
      viewer.scene.canvas.addEventListener("wheel", wake, { passive: true });
      wakeSpin = wake;
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
          // snaps the globe through however long the spin was paused. `wake` also resets the
          // idle clock and asks for the frame that restarts the loop — without that second half
          // this resumes a spin that, under requestRenderMode, would never be stepped.
          wake();
        };

      viewerInstanceRef.current = viewer;

      // Dev-only handle for inspecting the scene from the console or a browser-automation
      // probe: entity counts after a day switch, camera pose, tile detail. Nothing else
      // reaches the viewer — it lives in a closure here and in a ref in mapCamera — and the
      // route geometry is only verifiable by counting what is actually in the collection.
      // Stripped from production builds by the NODE_ENV check.
      if (process.env.NODE_ENV === "development") {
        const w = window as Window & { __tripmateViewer?: unknown; __tripmateCesium?: unknown };
        w.__tripmateViewer = viewer;
        // The module too, so a probe can build a BoundingSphere or HeadingPitchRange and check
        // the framing instantly. Cesium is only ever reached through a dynamic import here, so
        // there is otherwise no handle on its classes from outside a module scope.
        w.__tripmateCesium = Cesium;
      }

      setViewer(viewer);
    })();

    return () => {
      cancelled = true;
      viewerInstanceRef.current = null;
      setViewer(null);
      if (viewer) {
        if (spinListener) viewer.scene.postRender.removeEventListener(spinListener);
        if (pauseSpin) viewer.scene.canvas.removeEventListener("pointerdown", pauseSpin);
        if (wakeSpin) viewer.scene.canvas.removeEventListener("wheel", wakeSpin);
      }
      if (resumeSpin) window.removeEventListener("pointerup", resumeSpin);
      viewer?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  return (
    <>
      {/* `invisible` (visibility: hidden) — not `hidden` (display: none), and not unmounting.
          A zero-size canvas sends Cesium's own resize path through a 0x0 drawing buffer and back,
          which reallocates the framebuffer and re-rasters every resident tile on the way in; and
          `scene.canvas.clientWidth`/`clientHeight` are read per frame by StopMarkerLayer's
          reprojection and once at construction by the `renderMegapixels` request-cap decision.
          `visibility` keeps layout, the WebGL context and the drawing buffer, and costs one
          composite of a texture the GPU already owns.

          This is also what kills the stale-geometry bug, for every surface at once rather than
          per call site: `.map-chrome-hidden` hides `.map-controls` and `.stop-marker-layer`, two
          DOM layers, but route arcs and glow pools are Cesium entities *inside* the canvas, so
          navigating `/trip/[id]` -> `/profile` used to leave the last trip's arcs in the margins
          of a settings form.

          It also takes the canvas out of hit-testing, so Cesium's ScreenSpaceEventHandler stops
          consuming wheel events as camera zooms here. That does NOT make the page scroll on its
          own — this canvas's ancestor is `.app-shell`, `h-dvh overflow-hidden` — so
          `.content-overlay:not(:has(.docked-panel))` in globals.css is still the only thing
          handing scroll back. Do not delete it as redundant. */}
      <div
        ref={containerRef}
        className={`h-full w-full ${globeWanted ? "" : "invisible"}`}
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
