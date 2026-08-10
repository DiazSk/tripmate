"use client";

import dynamic from "next/dynamic";
import { ReactNode } from "react";
import { MapCameraProvider } from "@/lib/mapCamera";
import BrandMark from "@/components/BrandMark";

const GlobeBackground = dynamic(() => import("@/components/GlobeBackground"), {
  ssr: false,
});
const MapControls = dynamic(() => import("@/components/MapControls"), { ssr: false });

/**
 * Every route gets the same full-bleed globe + overlay content layout — the
 * split-pane mode this used to switch between per-route is retired, since the
 * app now uses a translucent glass panel over the globe everywhere instead of
 * a separate opaque content pane.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
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
            `overflow-y-auto` stays — the home page's pre-result steps are normal-flow children
            and overflow on short viewports, and scroll chaining from those children up to this
            ancestor is unaffected by pointer-events. */}
        <div className="pointer-events-none absolute inset-0 z-10 overflow-y-auto">{children}</div>
        {/* Sibling of the content overlay, not a child of it: the wordmark is app chrome like
            the map controls, so it stays put no matter what shape a page's own content column
            takes. Above z-10 so the right-docked panels can't cover it. */}
        <BrandMark />
        <MapControls />
      </div>
    </MapCameraProvider>
  );
}
