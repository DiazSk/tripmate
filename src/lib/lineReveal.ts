"use client";

import { useEffect, RefObject } from "react";
import { gsap, SplitText } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { useScrollContainer } from "@/lib/scrollContainer";

/**
 * The sequence's one text-entrance: every heading arrives a line at a time, each line rising
 * out from behind its own bottom edge.
 *
 * The mask is the whole point and the reason this is not a fade. `SplitText` with
 * `type: "lines"` and `mask: "lines"` (GSAP 3.13+) wraps each measured line in its own
 * `overflow: hidden` box, so translating the line up from `yPercent: 100` reads as type being
 * uncovered rather than type sliding into place. A fade tells you an element appeared; a mask
 * tells you it was always there and something moved off it.
 *
 * **Lines, not words or characters.** Splitting a sentence into words gives you a stagger with
 * no shape to it — the eye tracks seven separate objects and reads none of them. A line is the
 * unit the reader is already using. `HowItWorks`' heading shipped as `type: "words"`; this is
 * the same plugin doing the thing it is actually for.
 *
 * `expo.out` at 0.9s is the app's documented house curve (`cubic-bezier(0.16, 1, 0.3, 1)`,
 * which `expo.out` is the GSAP name for) rather than a second easing vocabulary for text.
 *
 * Three non-obvious requirements, all learned the hard way in this codebase:
 * - **`fromTo`, never `from`.** React Strict Mode double-invokes effects in dev; a `from()`
 *   tween re-created on the second run reads the element's current (already hidden) state as
 *   its own destination and animates from invisible to invisible.
 * - **Revert the split on cleanup.** `SplitText` rewrites the element's innerHTML into
 *   per-line divs. Leaving that in place across a re-split nests wrappers until the line
 *   measurement is garbage.
 * - **Re-split once fonts land.** Line breaks are a function of the font's metrics, so a split
 *   measured against the fallback face wraps at the wrong words. `document.fonts.ready` is the
 *   only reliable signal, and this app loads four webfonts.
 */
export function useLineReveal(
  ref: RefObject<HTMLElement | null>,
  { start = "top 85%", delay = 0 }: { start?: string; delay?: number } = {},
) {
  const container = useScrollContainer();

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    let split: SplitText | null = null;
    let ctx: gsap.Context | null = null;
    let cancelled = false;

    const build = () => {
      if (cancelled || !ref.current) return;
      split = new SplitText(ref.current, {
        type: "lines",
        // GSAP 3.13's own masking: one overflow-hidden wrapper per line, so nothing here has
        // to hand-roll a wrapper element or guess at line-box height.
        mask: "lines",
        linesClass: "line-reveal-line",
      });
      ctx = gsap.context(() => {
        gsap.fromTo(
          split!.lines,
          { yPercent: 100 },
          {
            yPercent: 0,
            duration: 0.9,
            ease: "expo.out",
            stagger: 0.09,
            delay,
            scrollTrigger: {
              trigger: ref.current,
              scroller: container?.current ?? undefined,
              start,
            },
          },
        );
      }, ref.current);
    };

    // Already-loaded fonts resolve this microtask-fast, so there is no flash of unsplit type on a
    // warm cache. Guarded because `document.fonts` is not universally present — reading `.ready`
    // off `undefined` throws from inside an effect, which takes the whole route down instead of
    // degrading. Without the FontFaceSet the split is simply built now and measured against
    // whatever face is loaded, which is a slightly worse line break rather than a blank page.
    if (document.fonts?.ready) document.fonts.ready.then(build);
    else build();

    return () => {
      cancelled = true;
      ctx?.revert();
      split?.revert();
    };
  }, [ref, container, start, delay]);
}
