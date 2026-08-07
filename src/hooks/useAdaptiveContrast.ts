"use client";

import { useEffect, useRef, useState } from "react";
import type { CesiumGlobeControls } from "@/components/cesium/CesiumGlobe";

const SAMPLE_INTERVAL_MS = 400;
// Standard relative-luminance weights. Measured empirically: deep space is
// ~4, any visible terrain/ocean (bundled Natural Earth II imagery, or Ion
// world imagery when a token is set) comes in around 140-190 — a big, clean
// gap, so the threshold just needs to sit comfortably between "space" and
// "literally any map surface" while still leaving room for genuinely dark
// real-world imagery (night tiles, deep ocean) to stay classified as dark.
const LUMINANCE_THRESHOLD = 110;
// Small box around the title specifically, not the whole header bar — a wide
// sample would blend the title's backdrop with the nav links' backdrop,
// which can disagree once the screen is split (map left, panel right).
const SAMPLE_BOX_WIDTH = 90;
const SAMPLE_BOX_HEIGHT = 28;
const TITLE_OFFSET_X = 90;

function luminance(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Samples the average color of the globe canvas directly under a header
 * element and reports whether it's dark or light, so the header can flip
 * between light-on-dark and dark-on-light-with-a-scrim. Only does anything
 * once `globe.ready` — degrades to `isDark: true` (safe default: the initial
 * background is deep space) when there's nothing to sample yet.
 */
export function useAdaptiveContrast(
  globe: CesiumGlobeControls,
  elementRef: React.RefObject<HTMLElement | null>
) {
  const [isDark, setIsDark] = useState(true);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!globe.ready) return;

    let lastSampleAt = 0;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
        lastSampleAt = now;
        const el = elementRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          const color = globe.sampleAverageColor(
            rect.left + TITLE_OFFSET_X,
            rect.top + rect.height / 2,
            SAMPLE_BOX_WIDTH,
            SAMPLE_BOX_HEIGHT
          );
          if (color) {
            setIsDark(luminance(color.r, color.g, color.b) < LUMINANCE_THRESHOLD);
          }
        }
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [globe, elementRef]);

  return isDark;
}
