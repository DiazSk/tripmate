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

/**
 * Subscribe form, for `useSyncExternalStore`.
 *
 * The one-shot read above is right for a decision made once (a tilt gate, a tween's config). It is
 * wrong for anything whose *rendered output* depends on the answer: reading it in an effect and
 * calling `setState` is the pattern React 19's `react-hooks/set-state-in-effect` rule exists to
 * flag, and it also silently ignores the visitor changing the setting mid-session — which this
 * module's own note says can happen.
 *
 * Pair it with a `false` server snapshot so the server renders the reduced-motion layout and the
 * client upgrades. That direction matters: the motion-free version is the one that has to be
 * correct without JavaScript.
 */
export function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
