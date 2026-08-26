import Link from "next/link";

/** Shared class for a surface's own top-right action ("My memories", "New trip"). */
export const headerLinkClass =
  "hero-legible pointer-events-auto text-sm font-medium text-on-deep hover:underline";

/** Shared class for a docked panel's own top-left "back to the globe" pill. */
export const backPillClass =
  "pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.08] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.14]";

/**
 * The TripMate wordmark, and the only one in the app. Rendered once by AppShell rather than
 * by each page, because the pages that carry content in the right-docked panel were embedding
 * it inside that panel and it came out top-right; anchoring it to the shell is what makes
 * "top-left of the screen" true on every route instead of per-page-column.
 *
 * Plain type over the globe — no glass bar, no pill — with the hero's layered text-shadow so
 * it survives whatever the camera is pointed at. Positioned to land on the same optical line
 * as each page's own `p-5 sm:p-6` first row.
 */
export default function BrandMark() {
  return (
    <Link
      href="/"
      className="hero-rise hero-legible pointer-events-auto absolute top-5 left-5 z-20 font-display text-xl font-semibold text-on-deep sm:top-6 sm:left-6"
    >
      TripMate
    </Link>
  );
}
