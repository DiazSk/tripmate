"use client";

import { useEffect, useRef } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useCesiumViewer } from "@/hooks/useCesiumViewer";

export type CesiumGlobeControls = ReturnType<typeof useCesiumViewer>;

export default function CesiumGlobe({
  onReady,
}: {
  onReady?: (controls: CesiumGlobeControls) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controls = useCesiumViewer(containerRef);

  useEffect(() => {
    if (controls.ready) onReady?.(controls);
    // Only re-fire when readiness flips, not on every render's new function identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls.ready]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
      {!controls.ready && <EarthSkeleton />}
    </div>
  );
}

/**
 * Shown for the ~1s Cesium takes to boot, instead of a blank black screen —
 * a rough silhouette of the real globe's framing, no imagery/pixels involved.
 * Size/position were fit (least-squares circle fit over 28 sampled points,
 * residuals within ~4px) to the live idle-view globe's horizon: top edge at
 * ~54.7% of viewport height, diameter ~205% of viewport width, centered
 * horizontally — not an eyeballed guess.
 */
function EarthSkeleton() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-stone-950">
      <div
        className="absolute left-1/2 top-[54.7%] aspect-square w-[205vw] max-w-none -translate-x-1/2 animate-pulse rounded-full opacity-70 blur-sm"
        style={{
          background:
            "radial-gradient(circle at 35% 30%, #3b6b8c, #1f3d52 55%, #101c26 85%)",
        }}
      />
    </div>
  );
}
