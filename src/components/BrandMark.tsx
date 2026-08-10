import Link from "next/link";

/** Shared class for a surface's own top-right action ("My memories", "New trip"). */
export const headerLinkClass =
  "hero-legible pointer-events-auto text-sm font-medium text-on-deep hover:underline";

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
      className="hero-rise hero-legible pointer-events-auto absolute top-5 left-5 z-20 font-display text-xl font-semibold tracking-tight text-on-deep sm:top-6 sm:left-6"
    >
      TripMate
    </Link>
  );
}
