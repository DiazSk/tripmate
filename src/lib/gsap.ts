"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

// Registered once per module load rather than per-component — gsap.registerPlugin is a no-op on
// repeat calls, but this keeps every consumer's import list to just `import { gsap } from
// "@/lib/gsap"` instead of re-registering everywhere.
//
// ScrollTrigger is registered but not re-exported, and that is not an oversight: both of its users
// reach it through a config object (`scrollTrigger: {…}` in lineReveal, ImageRow and HeroPoster),
// never by name. Registration is the whole contract. Nothing else may be added to this module's
// exports without a GSAP dependency — `prefersReducedMotion` used to live here and pulled all of
// GSAP into the root bundle for a `matchMedia` call; it is in `lib/reducedMotion.ts` now.
gsap.registerPlugin(ScrollTrigger, SplitText);

export { gsap, SplitText };
