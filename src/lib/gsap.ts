"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

// Registered once per module load rather than per-component — gsap.registerPlugin is a
// no-op on repeat calls, but this keeps every scene component's import list to just
// `import { gsap, ScrollTrigger } from "@/lib/gsap"` instead of re-registering everywhere.
gsap.registerPlugin(ScrollTrigger, SplitText);

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export { gsap, ScrollTrigger, SplitText };
