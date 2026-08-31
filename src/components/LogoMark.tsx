/**
 * The TripMate logo mark: four arms radiating from a pinched centre. The widest member of the same
 * asterisk family as `SectionOpener`'s section rule (six strokes) and the CTA's four-point star.
 *
 * Named `LogoMark` and not `BrandMark` because that name is taken by a legacy module — see the note
 * at the foot of this comment.
 *
 * Inlined rather than loaded from `public/scenes/image-logo.svg` through `next/image`, for three
 * reasons in order of weight:
 *
 * 1. **`fill="currentColor"`.** The file fills `white`, which cannot follow the wordmark beside it —
 *    and that wordmark changes colour by state and by surface. Inline, the mark is locked to its own
 *    text and can never drift out of step with it.
 * 2. **The file bakes `opacity="0.4"` onto its group.** Right for a watermark, wrong for an identity
 *    mark on frosted glass over photography, where it disappears. Dropped deliberately; if the mark
 *    should ever be quiet, that is the caller's `text-*` opacity to choose, not a value welded into
 *    the asset.
 * 3. Four paths at ~1.5KB cost less than a request, and this renders in the root layout on every
 *    route — so as a file it would be fetched before almost anything else on a cold load.
 *
 * `public/scenes/image-logo.svg` stays as the master. These paths are a copy of it, which is the
 * price of points 1 and 2: if the mark is redrawn, this file is what needs updating.
 *
 * Sized in `em` by default so a caller sets the mark's size by setting its type size, and the two
 * stay in proportion if the type step moves.
 *
 * The PWA's static home-screen icons (`public/icons/`, `src/app/apple-icon.png`) were generated
 * once from these same paths — see git history for the generation script — and aren't wired to
 * regenerate from this file automatically. Redraw both by hand together if the mark changes.
 */
export default function LogoMark({ className = "h-[1em] w-[1em]" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 18 18" fill="currentColor" className={`${className} shrink-0`}>
      <path d="M17.9648 15.4845L12.2265 12.3296C11.1524 11.6804 10.496 10.5167 10.496 9.26157L10.496 8.73699C10.496 7.48267 11.1516 6.31954 12.2246 5.67001C13.7801 4.72843 17.9648 2.53943 17.9648 2.53943L17.9648 6.91543L14.6615 8.40731C14.4218 8.51555 14.2677 8.75419 14.2677 9.01715C14.2678 9.27752 14.4188 9.51423 14.655 9.62392L17.9648 11.1615L17.9648 15.4845Z" />
      <path d="M5.65848e-07 15.4845L5.73835 12.3296C6.81248 11.6804 7.46888 10.5167 7.46888 9.26157L7.46888 8.73699C7.46888 7.48267 6.81329 6.31954 5.74024 5.67001C4.1847 4.72843 0 2.53943 0 2.53943L1.91281e-07 6.91543L3.30338 8.40731C3.54303 8.51555 3.6971 8.75419 3.6971 9.01715C3.69708 9.27752 3.546 9.51423 3.30987 9.62392L3.76881e-07 11.1615L5.65848e-07 15.4845Z" />
      <path d="M15.4295 0L12.2746 5.73835C11.6253 6.81248 10.4616 7.46888 9.20651 7.46888H8.68194C7.42762 7.46888 6.26448 6.81329 5.61496 5.74024C4.67337 4.1847 2.48438 0 2.48438 0H6.86038L8.35226 3.30337C8.46049 3.54303 8.69913 3.6971 8.9621 3.6971C9.22246 3.69708 9.45918 3.546 9.56887 3.30987L11.1064 0H15.4295Z" />
      <path d="M2.468 18L5.62287 12.2617C6.27214 11.1875 7.43583 10.5311 8.69095 10.5311L9.21552 10.5311C10.4698 10.5311 11.633 11.1867 12.2825 12.2598C13.2241 13.8153 15.4131 18 15.4131 18L11.0371 18L9.5452 14.6966C9.43697 14.457 9.19833 14.3029 8.93536 14.3029C8.675 14.3029 8.43828 14.454 8.32859 14.6901L6.79105 18L2.468 18Z" />
    </svg>
  );
}
