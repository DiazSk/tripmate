"use client";

import { useEffect, RefObject } from "react";

/**
 * Per-frame decay, expressed at 60fps and then corrected for the real frame time below. Lands
 * 95% of a step in ~150ms.
 *
 * This was briefly 0.07, measured off vita-travel.webflow.io's own
 * `ScrollSmoother.create({ smooth: 1.2 })` — its content takes ~700ms to catch up to a step, and
 * matching that number made this app feel *worse*, not more like the reference. The reason is a
 * mechanism difference the number hides: ScrollSmoother never touches the wheel. The browser
 * scrolls natively and instantly, and the plugin lags the *rendered* content behind it, so 700ms
 * of trailing costs nothing in responsiveness. This hook preventDefaults and moves the page
 * itself, so every millisecond of glide is a millisecond of genuine input latency. Trailing
 * render reads as softness; delayed input reads as lag. They are not the same effect at the same
 * duration, and only the first one scales.
 *
 * So the glide is tuned for *this* mechanism rather than copied from that one. Keep it short.
 */
const DECAY_PER_60FPS_FRAME = 0.28;

/** One frame at 60fps, the rate `DECAY_PER_60FPS_FRAME` is calibrated against. */
const REFERENCE_FRAME_MS = 1000 / 60;

/**
 * Longest frame the decay is allowed to integrate over. A 30fps phone (33ms) passes through
 * untouched; a GC pause, a tab switch or a Cesium tile commit can produce a 300ms frame, and
 * without this ceiling the glide would resolve its whole remaining distance in that one jump.
 */
const MAX_FRAME_MS = 50;

/**
 * Below a pixel the movement is invisible, and continuing to write fractional values keeps the
 * frame loop alive re-rasterising text for no visible gain.
 */
const SETTLE_PX = 1;

/**
 * Wheel deltas do not arrive in a single unit. `deltaMode` 1 is lines and 2 is pages — Firefox
 * still reports lines for a real mouse wheel — so a raw `deltaY` of 3 means three *lines*, and
 * treating it as three pixels makes a full notch move the page almost not at all.
 */
function pixelDelta(e: WheelEvent, viewport: number): number {
  if (e.deltaMode === 1) return e.deltaY * 40;
  if (e.deltaMode === 2) return e.deltaY * viewport;
  return e.deltaY;
}

/**
 * Inertial wheel scrolling for the app shell's content overlay.
 *
 * **Why this is not GSAP's ScrollSmoother.** ScrollSmoother is the obvious answer and it cannot
 * attach here. It works by making `#smooth-wrapper` `position: fixed` and translating
 * `#smooth-content` inside it — the document keeps a real scroll height, the content is moved by
 * transform, and the *window* is always the scroller. This app has no window scroll at all:
 * `.app-shell` is `h-dvh overflow-hidden` because a full-viewport Cesium canvas sits behind every
 * route at z-0, and `.content-overlay` — an `absolute inset-0 overflow-y-auto` sibling — is the
 * real scroller. ScrollSmoother has no `scroller` option to point at it, and giving the window
 * the scroll back would mean the globe scrolls away with the page.
 *
 * So this does the same job the other way round: instead of faking scroll with a transform, it
 * *actually* sets `scrollTop`, easing it toward a wheel-accumulated target. That is a smaller
 * idea with two concrete advantages over the plugin it replaces — ScrollTrigger needs no
 * `scrollerProxy()` because the scroll position it reads is genuinely the scroll position, and
 * pinning works normally rather than fighting a translated content layer.
 *
 * Deliberately narrow:
 * - **Wheel only.** Scrollbar drags, keyboard paging, anchor jumps and `scrollTo` all still move
 *   the element natively; the lerp bails the moment it sees a scroll it did not cause, so
 *   dragging the bar never fights an animation pulling it somewhere else.
 * - **Vertical intent only.** A gesture whose horizontal component dominates belongs to whatever
 *   scrolls sideways under the cursor (the day-tab strip), not to the page.
 * - **Fine pointers only.** Touch already has real momentum from the compositor, and intercepting
 *   `wheel` on a touch surface is how smooth-scroll libraries earn their reputation.
 * - **Reduced motion off.** An involuntary half-second of continued movement after the input
 *   stops is exactly what that preference is about.
 *
 * Both media queries are re-evaluated on `change`, not only at mount: a 2-in-1 flipping out of
 * tablet mode, an external mouse plugged into a tablet, or the OS reduced-motion toggle all
 * change the correct answer mid-session, and a mount-time snapshot would keep the wrong one.
 */
export function useSmoothScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // `pointer: fine` alone is true for a laptop with a touchscreen; pairing it with
    // `hover: hover` is the standard test for "a real pointer is the primary input".
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const calmMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let target = el.scrollTop;
    let frame = 0;
    let running = false;
    // The last value this hook wrote. Comparing the incoming scroll position against it is how a
    // foreign scroll is identified — see `onScroll`.
    let written = -1;
    let lastFrame = 0;
    let attached = false;

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      running = false;
    };

    /** The scroll range as it is *right now*, not as it was when the gesture started. */
    const maxScroll = () => Math.max(0, el.scrollHeight - el.clientHeight);

    const tick = (now: number) => {
      // Elapsed time, not "one frame". A fixed per-frame decay is a different animation on every
      // machine: an earlier version took 0.12 of the remaining distance per frame, which is 391ms
      // to 95% on a 60Hz panel, 175ms on the 134Hz one it was developed against, and 96ms at
      // 240Hz. Anything easing toward a target across frames belongs to elapsed time.
      const dt = Math.min(now - lastFrame, MAX_FRAME_MS);
      lastFrame = now;
      const decay = Math.pow(1 - DECAY_PER_60FPS_FRAME, dt / REFERENCE_FRAME_MS);

      // Re-clamp every frame against the live range. The content in this scroller changes height
      // while it is being scrolled — ScrollTrigger's pin spacer appears and disappears,
      // `next/image` resolves and reflows, a refresh re-measures — so a target that was legal
      // when the wheel arrived can end up past the end of the page. Left unclamped the lerp then
      // chases a position the element cannot reach: every write gets clamped by the browser,
      // `delta` never falls under the settle threshold, and rAF spins against the boundary for
      // the rest of the session. Clamping here makes that unrepresentable.
      target = Math.min(target, maxScroll());

      const current = el.scrollTop;
      const delta = target - current;
      if (Math.abs(delta) < SETTLE_PX) {
        written = target;
        el.scrollTop = target;
        stop();
        return;
      }
      el.scrollTop = current + delta * (1 - decay);
      // Read back what the element actually took: a fractional scrollTop is rounded on some
      // engines and clamped at the ends, and comparing against the value we asked for rather than
      // the one it kept would read as a foreign scroll on the very next event.
      written = el.scrollTop;

      // The element refused to move where it was asked, so we are against a real boundary — stop
      // instead of leaning on it every frame for the rest of the session.
      //
      // This is the backstop that makes the whole loop safe, and it exists because
      // `scrollHeight - clientHeight` is *not a reachable position*. Measured here: a page whose
      // computed maximum was 1421 could only actually reach 1419, so the clamped target stayed
      // 2px away, `delta` never fell under the settle threshold, and rAF span forever holding the
      // page against its own bottom edge. Sub-pixel layout, the zoom level, the scrollbar gutter
      // and per-engine rounding all move that true limit independently, which is precisely why a
      // computed range cannot be trusted and an observed one can. Asking "did the element move?"
      // needs no knowledge of why the floor is where it is, so it is correct on every engine and
      // at every zoom rather than on the machine it was written on.
      // `written === current` covers the second way a frame can make no progress: an engine that
      // rounds `scrollTop` to whole pixels (some do, and which ones depends on the zoom level)
      // turns a sub-pixel step into no step at all, which the tolerance below would read as
      // "landed where asked, keep going" and loop on forever a pixel from the target. Either way
      // the element is not moving, and the answer is the same.
      //
      // Accepted cost: `scrollTop` has a device-dependent granularity (a third of a pixel on the
      // machine this was measured on), so the last fraction of a *very* small isolated gesture is
      // dropped — a lone 5px flick lands around 2px. Invisible, and it cannot accumulate: a wheel
      // arriving while nothing is animating re-seats the target on the real position, so the next
      // gesture starts from where the page actually is rather than from where this one gave up.
      if (written === current || Math.abs(written - current) < 0.05) {
        target = written;
        stop();
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
      // Let the browser own anything modified: ctrl/cmd+wheel is zoom, shift+wheel is horizontal,
      // and a pinch arrives as ctrl+wheel too.
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      // Defer only on a *decisively* sideways gesture — a two-finger swipe aimed at something
      // that scrolls horizontally, like the day-tab strip.
      //
      // The dominance ratio and the floor are both load-bearing. A bare `|dx| > |dy|` test looks
      // equivalent and is not: a trackpad's vertical drag carries constant small horizontal
      // drift, and at the start and end of a gesture both components are near zero, so pairs like
      // `dx 0.7 / dy 0.5` are routine. That test drops every one of them, which swallows the
      // opening events of a gentle two-finger drag — the page refuses to move until you push it
      // hard, and reads as stuck rather than as picky. Requiring 2x dominance and more than 2px
      // of horizontal travel cannot fire on a vertical drag with drift, and still catches a real
      // sideways swipe.
      //
      // Worth knowing: neither a synthetic `WheelEvent` nor a CDP-injected one carries `deltaX`
      // at all, so this class of bug is invisible to both scripted and driver-level testing. It
      // only exists on a real trackpad.
      const dx = Math.abs(e.deltaX);
      if (dx > Math.abs(e.deltaY) * 2 && dx > 2) return;
      // A wheel over a nested scroller (the itinerary panel, the day-tab strip) belongs to that
      // element. Walk up from the target and bail if anything scrollable sits between it and us.
      let node = e.target as HTMLElement | null;
      while (node && node !== el) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) {
          return;
        }
        node = node.parentElement;
      }

      // Re-seat the target on the real position whenever we are not already animating, so a
      // native scroll that happened in between (a drag, an anchor jump) is respected instead of
      // being yanked back to a stale target.
      if (!running) target = el.scrollTop;
      const next = Math.max(0, Math.min(maxScroll(), target + pixelDelta(e, el.clientHeight)));
      const atLimit = next === target;

      // The stutter this shape exists to prevent, at both ends of the page:
      //
      // Returning early whenever the target is already clamped — which the first version did —
      // hands the event to the browser *while the glide is still in flight*. The browser then
      // scrolls the element natively and instantly toward the limit, the resulting scroll event
      // is correctly identified as foreign and kills the lerp, and the next notch restarts it.
      // Held against the end of the page, that alternates between easing and jumping on every
      // notch, which is what reads as stuttering. It is also invisible to scripted testing:
      // `new WheelEvent()` is untrusted, so no browser performs default scrolling for it, and a
      // synthetic probe of this exact path traces a perfectly smooth curve.
      //
      // So while this hook is still moving the page it keeps the wheel, limit or not, and the
      // glide is allowed to finish. Only a *settled* scroller sitting at its limit hands the
      // event back — the one case where native overscroll is the right answer — and
      // `overscroll-behavior: contain` in globals.css stops that chaining to an ancestor with no
      // business scrolling.
      if (atLimit && !running) return;
      e.preventDefault();
      if (atLimit) return;

      target = next;
      if (!running) {
        running = true;
        lastFrame = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    // Any scroll this hook did not cause means the user grabbed the bar, pressed Page Down, or
    // something called `scrollIntoView` — drop the lerp rather than fight it for control.
    //
    // The test is "is the position what we last wrote", not "is the position near the target".
    // An earlier version compared against the target and killed the animation on its own opening
    // frame: at the start of a 600px glide the distance to target is 528px by design, which any
    // distance-from-target heuristic reads as a jump.
    const onScroll = () => {
      if (running && Math.abs(el.scrollTop - written) > 2) stop();
    };

    // A hidden tab still services rAF in some engines, and a blurred window means the gesture is
    // over either way. Neither should leave a glide running.
    const onIdle = () => stop();

    const attach = () => {
      if (attached) return;
      attached = true;
      el.addEventListener("wheel", onWheel, { passive: false });
      el.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("blur", onIdle);
      document.addEventListener("visibilitychange", onIdle);
    };

    const detach = () => {
      if (!attached) return;
      attached = false;
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("blur", onIdle);
      document.removeEventListener("visibilitychange", onIdle);
      stop();
    };

    const sync = () => {
      if (finePointer.matches && !calmMotion.matches) attach();
      else detach();
    };

    // `MediaQueryList.addEventListener` only arrived in Safari 14. On anything older it is
    // `undefined`, and calling it throws — from inside an effect, which takes the route down
    // rather than degrading. The deprecated `addListener` is the fallback, and if neither exists
    // the queries simply stop being live: the mount-time answer stands, which is the correct
    // graceful floor rather than a crash.
    const listen = (mq: MediaQueryList, on: boolean) => {
      if (typeof mq.addEventListener === "function") {
        if (on) mq.addEventListener("change", sync);
        else mq.removeEventListener("change", sync);
      } else if (typeof mq.addListener === "function") {
        if (on) mq.addListener(sync);
        else mq.removeListener(sync);
      }
    };

    sync();
    listen(finePointer, true);
    listen(calmMotion, true);
    return () => {
      listen(finePointer, false);
      listen(calmMotion, false);
      detach();
    };
  }, [ref]);
}
