/**
 * The TripMate logo mark, reduced to a glyph: a globe, a route lifting off it, and the stop it lands
 * on. The full-colour app icon (glass lens, dawn light, jade stop) lives in `mobile/assets/brand/`;
 * this is its one-colour small cut, drawn thick enough to survive at the navbar's ~20px.
 *
 * Inlined rather than loaded from `public/scenes/image-logo.svg` through `next/image`, for three
 * reasons in order of weight:
 *
 * 1. **`currentColor`.** The file strokes `white`, which cannot follow the wordmark beside it — and
 *    that wordmark changes colour by state and by surface. Inline, the mark is locked to its own text
 *    and can never drift out of step with it.
 * 2. **The file bakes `opacity="0.4"` onto its group.** Right for a watermark, wrong for an identity
 *    mark on frosted glass over photography, where it disappears. Dropped deliberately; if the mark
 *    should ever be quiet, that is the caller's `text-*` opacity to choose.
 * 3. Five shapes cost less than a request, and this renders in the root layout on every route — so
 *    as a file it would be fetched before almost anything else on a cold load.
 *
 * `public/scenes/image-logo.svg` stays as the master. These shapes are a copy of it, which is the
 * price of points 1 and 2: if the mark is redrawn, this file is what needs updating.
 *
 * Sized in `em` by default so a caller sets the mark's size by setting its type size, and the two
 * stay in proportion if the type step moves.
 *
 * The PWA's static icons (`public/icons/`, `src/app/apple-icon.png`, `src/app/favicon.ico`) and the
 * native app icons are rendered from the SVG masters in `mobile/assets/brand/` — see its README.
 * They do not regenerate from this file, so redraw them together if the mark changes.
 */
export default function LogoMark({ className = "h-[1em] w-[1em]" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 18 18" fill="none" stroke="currentColor" className={`${className} shrink-0`}>
      <circle cx="9" cy="9" r="7.6" strokeWidth="1.3" />
      <ellipse cx="9" cy="9" rx="3" ry="7.6" strokeWidth="0.9" opacity="0.45" transform="rotate(-16 9 9)" />
      <path d="M5.2 12.6Q7.6 2.2 12.8 8" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="5.2" cy="12.6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.8" cy="8" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}
