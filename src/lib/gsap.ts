"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

// Registered once per module load rather than per-component — gsap.registerPlugin is a
// no-op on repeat calls, but this keeps every scene component's import list to just
// `import { gsap, ScrollTrigger } from "@/lib/gsap"` instead of re-registering everywhere.
gsap.registerPlugin(ScrollTrigger, SplitText);

// Re-exported, not defined here — see the note in `reducedMotion.ts` for why it moved out.
export { prefersReducedMotion } from "./reducedMotion";

export { gsap, ScrollTrigger, SplitText };
