/**
 * Does this visitor want motion kept to a minimum?
 *
 * Its own module rather than living in `@/lib/gsap` (which re-exports it, so the scene
 * components that already import it from there are unchanged): the map stack needs this check
 * too, and importing it from the gsap module would pull GSAP and its plugins into
 * `GlobeBackground` and `mapCamera` — i.e. into every route that renders the globe, including
 * the ones that have no scroll story at all.
 *
 * Read at call time, not cached: the OS setting can change while the tab is open.
 */
export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
