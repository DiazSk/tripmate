"use client";

import dynamic from "next/dynamic";
import { ReactNode } from "react";
import { MapCameraProvider } from "@/lib/mapCamera";

const GlobeBackground = dynamic(() => import("@/components/GlobeBackground"), {
  ssr: false,
});

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <MapCameraProvider>
      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        <div className="relative h-[40vh] w-full shrink-0 md:h-full md:w-[55%]">
          <GlobeBackground />
        </div>
        <div className="w-full flex-1 overflow-y-auto md:h-full md:w-[45%]">{children}</div>
      </div>
    </MapCameraProvider>
  );
}
