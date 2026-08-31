"use client";

import dynamic from "next/dynamic";
import { ReactNode, useEffect, useRef, useState } from "react";
import { MotionConfig } from "framer-motion";
import { MapCameraProvider } from "@/lib/mapCamera";
import { resolveMapEngine } from "@/lib/mapEngine";
import Navbar from "@/components/Navbar";
import InstallPrompt from "@/components/InstallPrompt";
import { ScrollContainerContext } from "@/lib/scrollContainer";

const GlobeBackground = dynamic(() => import("@/components/GlobeBackground"), {
  ssr: false,
});
const MapLibreBackground = dynamic(() => import("@/components/MapLibreBackground"), {
  ssr: false,
});
const MapControls = dynamic(() => import("@/components/MapControls"), { ssr: false });
const MapEngineToggle = dynamic(() => import("@/components/MapEngineToggle"), { ssr: false });
const StopMarkerLayer = dynamic(() => import("@/components/StopMarkerLayer"), { ssr: false });

/**
 * Every route gets the same full-bleed globe + overlay content layout — the
 * split-pane mode this used to switch between per-route is retired, since the
 * app now uses a translucent glass panel over the globe everywhere instead of
 * a separate opaque content pane.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  // Handed to ScrollContainerContext below. Nothing animates it — scrolling here is native and
  // compositor-owned, which is the whole point; see globals.css's `.content-overlay`.
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Which engine draws the world — see `src/lib/mapEngine.ts`.
   *
   * Resolved once, in a lazy initialiser rather than an effect, so the decision is made before
   * the first paint and no background component ever mounts and then gets replaced. It reads
   * `localStorage` and `location.search`, so it cannot run during SSR; `resolveMapEngine` returns
   * the build default there and the lazy `useState` means that value is never rendered on the
   * client anyway, because `useState` initialisers do not re-run.
   *
   * Both backgrounds are rendered, but each only *builds* once it is the active engine — the
   * `active` prop below feeds their existing one-way `built` latch, so the engine nobody has asked
   * for costs nothing beyond a mounted component with no canvas. That is the same reasoning
   * `globeWanted` uses to keep Cesium off `/profile`, applied one level up.
   *
   * Once built, neither is torn down. Toggling back and forth is then instant and keeps both tile
   * caches warm, which is the same argument `GlobeBackground`'s construction effect makes for
   * never swapping a viewer — it just applies to swapping *between* two as well.
   */
  const [mapEngine, setMapEngine] = useState(resolveMapEngine);

  // Production-only: registering in dev would cache Turbopack's HMR chunks, which is exactly
  // the kind of staleness the dev server exists to avoid.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
    }
  }, []);

  return (
    // `reducedMotion="user"` makes every framer-motion component honour
    // `prefers-reduced-motion` automatically (jumping straight to its end state)
    // without per-component code — this also retroactively fixes ItineraryCard's
    // existing `whileInView` reveal, which previously ignored the OS setting
    // entirely since Framer's own animations aren't caught by globals.css's
    // CSS-only `prefers-reduced-motion: reduce` blanket rule.
    <MotionConfig reducedMotion="user">
      <MapCameraProvider engine={mapEngine} onEngineChange={setMapEngine}>
        <div className="app-shell relative flex h-dvh flex-col overflow-hidden bg-canvas md:flex-row">
          <div className="absolute inset-0 z-0 bg-canvas">
            {/* The background must stay mounted across route changes — Next.js already keeps
                AppShell itself stable across navigations since it's rendered from the root
                layout, so this just needs to never be conditionally unmounted here. The engine
                branch is not a conditional unmount: `mapEngine` is resolved once and never
                changes for the life of the session. */}
            <GlobeBackground
              active={mapEngine === "cesium"}
              creditClassName="fixed bottom-1 left-3"
            />
            <MapLibreBackground
              active={mapEngine === "maplibre"}
              creditClassName="fixed bottom-1 left-3"
            />
          </div>
          {/* `pointer-events-none` is what makes the globe draggable: this container spans the
              whole viewport, so without it every pointer event lands here and the Cesium canvas
              at z-0 never sees one. Each real content box opts back in with `pointer-events-auto`.

              It also takes this element out of hit-testing, which is how a scroller stops being
              scrollable — for a wheel as much as for a finger. The canvas is this element's
              *sibling*, so a gesture that lands on it walks an ancestor chain containing nothing
              scrollable and reaches Cesium, which zooms. `.content-overlay` in globals.css hands
              pointer events back on every route that scrolls *this* element rather than a
              DockedPanel; see that rule for the full account and for what it costs. */}
          {/* Sits at z-5, under the content overlay below — the markers are part of the world
              behind the glass, so a panel covers them rather than the other way round. Still a
              sibling rather than a child of that overlay, and for a sharper reason than the
              wordmark: the overlay scrolls, and these cards are pinned to world coordinates on the
              globe, so inside it they would slide off their own stems the moment a page
              overflowed. */}
          <StopMarkerLayer />
          <div
            ref={scrollRef}
            className="content-overlay pointer-events-none absolute inset-0 z-10 overflow-y-auto"
          >
            {/* Exposes this element as the real scroll container — window never scrolls
                here (.app-shell is h-dvh overflow-hidden) — so the Blue Hour scroll story's
                scroll-linked motion (useScroll) has something other than `window` to track. */}
            <ScrollContainerContext.Provider value={scrollRef}>
              {children}
            </ScrollContainerContext.Provider>
          </div>
          {/* Sibling of the content overlay, not a child of it: the nav is app chrome like
              the map controls, so it stays put no matter what shape a page's own content column
              takes. Above z-10 so the right-docked panels can't cover it. */}
          <Navbar />
          <MapEngineToggle />
          <InstallPrompt />
          <MapControls />
        </div>
      </MapCameraProvider>
    </MotionConfig>
  );
}
