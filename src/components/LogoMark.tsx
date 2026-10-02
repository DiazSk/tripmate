/**
 * The TripMate logo mark, reduced to a glyph: a lit glass globe, a route lifting off it, and the jade stop it
 * lands on. The full app icon (glass lens, dawn light) lives in `mobile/assets/brand/`; this is its
 * small cut, with the fine latitudes dropped and the route and stop made bold enough for ~20px. The
 * rim follows `currentColor`, so it still tracks the wordmark; the globe and the jade stop are fixed.
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
 * 3. A handful of shapes cost less than a request, and this renders in the root layout on every route — so
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
    <svg aria-hidden viewBox="0 0 18 18" fill="none" className={`${className} shrink-0`}>
      <defs>
        <radialGradient id="lm-globe" cx="34%" cy="28%" r="80%">
          <stop offset="0" stopColor="#2b3a35" />
          <stop offset="1" stopColor="#0b0b0a" />
        </radialGradient>
        <linearGradient id="lm-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="1" />
          <stop offset="0.5" stopColor="currentColor" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ffbc98" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <circle cx="9" cy="9" r="8.3" fill="url(#lm-globe)" />
      <g transform="rotate(-16 9 9)" stroke="currentColor" strokeOpacity="0.4" strokeWidth="0.6">
        <ellipse cx="9" cy="9" rx="3.3" ry="7.2" />
        <ellipse cx="9" cy="9" rx="7.2" ry="1.5" />
      </g>
      <circle cx="9" cy="9" r="8.3" stroke="url(#lm-rim)" strokeWidth="1" />
      <path d="M4.3 12.7Q6 1.4 13 7.4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4.3" cy="12.7" r="0.85" fill="#fff" />
      <circle cx="13" cy="7.4" r="2.3" fill="#28b981" fillOpacity="0.4" />
      <circle cx="13" cy="7.4" r="1.35" fill="#28b981" stroke="#b8f5da" strokeOpacity="0.9" strokeWidth="0.3" />
    </svg>
  );
}
