"use client";

import dynamic from "next/dynamic";
import { ReactNode, useRef } from "react";
import { MotionConfig } from "framer-motion";
import { MapCameraProvider } from "@/lib/mapCamera";
import Navbar from "@/components/Navbar";
import DevInspectorOverlay from "@/components/dev/DevInspectorOverlay";
import { ScrollContainerContext } from "@/lib/scrollContainer";

const GlobeBackground = dynamic(() => import("@/components/GlobeBackground"), {
  ssr: false,
});
const MapControls = dynamic(() => import("@/components/MapControls"), { ssr: false });
const StopMarkerLayer = dynamic(() => import("@/components/StopMarkerLayer"), { ssr: false });

/**
 * Every route gets the same full-bleed globe + overlay content layout — the
 * split-pane mode this used to switch between per-route is retired, since the
 * app now uses a translucent glass panel over the globe everywhere instead of
 * a separate opaque content pane.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    // `reducedMotion="user"` makes every framer-motion component honour
    // `prefers-reduced-motion` automatically (jumping straight to its end state)
    // without per-component code — this also retroactively fixes ItineraryCard's
    // existing `whileInView` reveal, which previously ignored the OS setting
    // entirely since Framer's own animations aren't caught by globals.css's
    // CSS-only `prefers-reduced-motion: reduce` blanket rule.
    <MotionConfig reducedMotion="user">
      <MapCameraProvider>
        <div className="app-shell relative flex h-dvh flex-col overflow-hidden bg-canvas md:flex-row">
          <div className="absolute inset-0 z-0 bg-canvas">
            {/* GlobeBackground must stay mounted across route changes — Next.js already
                keeps AppShell itself stable across navigations since it's rendered from the
                root layout, so this just needs to never be conditionally unmounted here. */}
            <GlobeBackground creditClassName="fixed bottom-1 left-3" />
          </div>
          {/* `pointer-events-none` is what makes the globe draggable: this container spans the
              whole viewport, so without it every pointer event lands here and the Cesium canvas
              at z-0 never sees one. Each real content box opts back in with `pointer-events-auto`.

              That reasoning only holds for a wheel. A wheel scrolls the nearest scrollable
              ancestor whatever its pointer-events; a finger does not — WebKit resolves a touch
              scroll by hit-testing, and this element is not hit-testable, so on iOS nothing
              here scrolled at all. `.content-overlay` in globals.css hands touch back below
              `sm`, on the routes that scroll *this* element rather than a DockedPanel. */}
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
          <DevInspectorOverlay />
          <MapControls />
        </div>
      </MapCameraProvider>
    </MotionConfig>
  );
}
