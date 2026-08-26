/**
 * Whether the OS asks for reduced motion.
 *
 * Deliberately *not* in `lib/gsap.ts`, where it used to live (that module re-exports it, so scene
 * components importing it from there are unchanged). `gsap.ts` exists for its import side effect —
 * `gsap.registerPlugin(ScrollTrigger, SplitText)` — so anything that touches it drags 120KB of GSAP
 * into its bundle. Two separate callers made that untenable. `Navbar` wanted only this one-liner and
 * renders from `AppShell` in the root layout, so ScrollTrigger and SplitText were landing in the
 * bootstrap of every route in the app — visible in the build output, where the GSAP chunk was
 * referenced by the prerendered HTML of `/bench`, `/backend` and `/_not-found`, pages that have
 * never run a tween. And the map stack needs the same check, so importing it from `gsap.ts` would
 * pull GSAP into `GlobeBackground` and `mapCamera`, i.e. into every route that renders the globe.
 *
 * No `"use client"`: this is a pure leaf with no React import, like `lib/format.ts`. A client
 * component importing it is what makes it client code.
 *
 * Read on demand rather than cached at module scope, because the query can change mid-session.
 * Callers that deliberately want a one-time answer (TierPicker's tilt gate) cache it themselves.
 */
export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
