import Link from "next/link";

/**
 * Shared class for a surface's own top-right action ("My memories", "New trip").
 *
 * Underlined at rest, not only on hover: same size, weight and colour as the type
 * beside it, over terrain, with no pill and no chevron — hover was the only thing
 * that ever said "link", which leaves touch and keyboard with nothing. `min-h-11`
 * and the negative margin give it a 44px target without moving the text off the
 * optical line the wordmark sits on.
 */
export const headerLinkClass =
  "hero-legible pointer-events-auto -my-2.5 inline-flex min-h-11 items-center text-sm font-medium text-on-deep underline decoration-white/40 underline-offset-4 transition-colors hover:decoration-white focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none";

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
      className="hero-rise hero-legible pointer-events-auto absolute top-5 left-5 z-20 -m-2 inline-flex min-h-11 items-center p-2 font-display text-xl font-semibold tracking-tight text-on-deep focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none sm:top-6 sm:left-6"
    >
      TripMate
    </Link>
  );
}
