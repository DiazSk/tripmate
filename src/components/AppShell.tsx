"use client";

import dynamic from "next/dynamic";
import { ReactNode } from "react";
import { MapCameraProvider } from "@/lib/mapCamera";

const GlobeBackground = dynamic(() => import("@/components/GlobeBackground"), {
  ssr: false,
});

/**
 * Every route gets the same full-bleed globe + overlay content layout — the
 * split-pane mode this used to switch between per-route is retired, since the
 * app now uses a translucent glass panel over the globe everywhere instead of
 * a separate opaque content pane.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <MapCameraProvider>
      <div className="relative flex h-dvh flex-col overflow-hidden bg-[#0b0f19] md:flex-row">
        <div className="absolute inset-0 z-0 bg-[#0b0f19]">
          {/* GlobeBackground must stay mounted across route changes — Next.js already
              keeps AppShell itself stable across navigations since it's rendered from the
              root layout, so this just needs to never be conditionally unmounted here. */}
          <GlobeBackground creditClassName="fixed bottom-1 left-3" />
        </div>
        <div className="absolute inset-0 z-10 overflow-y-auto">{children}</div>
      </div>
    </MapCameraProvider>
  );
}
