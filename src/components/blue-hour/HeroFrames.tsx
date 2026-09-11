"use client";

import { useEffect, useRef } from "react";

import { useScrollContainer } from "@/lib/scrollContainer";
import { HERO_SEQUENCE, heroFrameUrl, type HeroTierId } from "./heroSequence";

/**
 * The hero's scroll-scrubbed frame sequence: 120 WebP frames of a dolly down the Siq to
 * Al-Khazneh, drawn to a canvas at whatever frame the visitor's scroll position asks for.
 *
 * Only mounted when the sequence can actually run — `Hero` gates on `prefers-reduced-motion` and
 * loads this lazily, so a visitor who asked for less motion never downloads this chunk and never
 * grows the hero track past one viewport.
 *
 * ## Why an `<img>` cache and not `createImageBitmap`
 *
 * `createImageBitmap` is the usual advice for this and it is wrong at this frame count. An
 * `ImageBitmap` is non-evictable by specification — it is the page's memory until `.close()` is
 * called on it. 120 frames of 1152x648 decoded RGBA is **358MB** resident, and the portrait tier
 * is not much better. `HTMLImageElement` hands the decoded-image cache to the UA instead, which
 * budgets it and evicts LRU, so the resident cost is the compressed bytes in the HTTP cache
 * (~5MB). `decoding = "async"` plus `await img.decode()` already gets the decode off the main
 * thread in Chrome and Safari, which was the only real reason to reach for `createImageBitmap`.
 *
 * ponytail: an evicted frame can cost a synchronous re-decode inside `drawImage`. Accepted — the
 * upgrade path, if a trace ever shows it, is a bounded +/-12 window of `createImageBitmap` sized
 * to the canvas with a mandatory `.close()` on eviction, which is ~69MB rather than 358.
 *
 * ## Why the loop is not "persistent"
 *
 * It stops itself the moment `current === target` and restarts from the scroll handler or from any
 * decode that lands. A genuinely persistent rAF loop would paint on an idle page, and on this app
 * that is not free: every full-viewport repaint forces the navbar's `backdrop-filter: blur(16px)`
 * panel to re-raster. `scripts/frame-probe.js` exists to assert an idle page paints ~0fps, and
 * this keeps that true while still satisfying what "continuous" has to mean — that no scroll
 * movement is ever missed and nothing is ever left mid-transition.
 */
export default function HeroFrames({ onLive }: { onLive: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scroller = useScrollContainer();
  // Held in a ref so the main effect never re-runs when the parent re-renders and hands over a
  // fresh closure — the sequence must not be torn down and rebuilt mid-scroll, which would drop
  // every decoded frame. Written in its own effect rather than during render: a ref write during
  // render is what `react-hooks/refs` flags, and it is genuinely unsafe under concurrent
  // rendering, where a render can be thrown away after the write has already landed.
  const onLiveRef = useRef(onLive);
  useEffect(() => {
    onLiveRef.current = onLive;
  }, [onLive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const scrollEl = scroller?.current;
    if (!canvas || !scrollEl) return;

    // Asks the DOM where it is rather than having four refs plumbed down from `Hero` — the same
    // instinct as `ItineraryCard` walking up for its scroller.
    const track = canvas.closest<HTMLElement>(".hero-track");
    const stage = canvas.closest<HTMLElement>(".hero-stage");
    if (!track || !stage) return;

    // `alpha: false` lets the compositor skip blending a full-viewport surface, which is the
    // largest single 2D-canvas win available here and free because the frames are opaque. It is
    // independent of the *element's* `opacity`, so the cross-fade still works.
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) return;

    const n = HERO_SEQUENCE.frames;
    const frames: (HTMLImageElement | null)[] = new Array(n).fill(null);
    const ready = new Uint8Array(n);

    let cancelled = false;
    let raf = 0;
    let inView = false;
    let last = 0;
    let current = 0;
    let target = 0;
    /** The frame index actually painted. -1 until the first draw, which is what makes "never
     *  blank" expressible: there is always either nothing drawn yet or a real frame held. */
    let drawnSrc = -1;
    /** The index we last tried to satisfy. Only advances on an *exact* hit, so a frame that
     *  decodes late still gets upgraded into place rather than being skipped forever. */
    let drawnWant = -1;
    let trackTop = 0;
    let travel = 1;

    // Portrait viewports get the 9:16 crop; everything else gets the landscape tier. Decided once
    // — a visitor who rotates mid-session keeps the tier they started with, which is a softer
    // crop for one session versus re-downloading 120 frames on an orientation change.
    const tier: HeroTierId = stage.clientHeight > stage.clientWidth ? "port" : "land";

    /* ---- drawing ------------------------------------------------------------------------- */

    /** `object-fit: cover`, by hand, in backing-store pixels. */
    const paint = (img: HTMLImageElement) => {
      const cw = canvas.width;
      const ch = canvas.height;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      if (!iw || !ih || !cw || !ch) return;
      // `max`, not `min` — that one character is the whole difference between cover and contain.
      const s = Math.max(cw / iw, ch / ih);
      const dw = iw * s;
      const dh = ih * s;
      // Five-arg form with negative offsets rather than a nine-arg source crop: same result, half
      // the arithmetic, and the UA clips either way. No `clearRect` — cover guarantees the drawn
      // rect covers the canvas on both axes and the frames are opaque, so clearing is pure waste.
      ctx.drawImage(img, (cw - dw) * 0.5, (ch - dh) * 0.5, dw, dh);
    };

    /** Bounded search outward from `i` for something decoded. Backward first: the frame you have
     *  just scrolled past is a better answer than one you have not reached yet. */
    const nearestReady = (i: number) => {
      if (ready[i]) return i;
      for (let d = 1; d <= 8; d++) {
        if (i - d >= 0 && ready[i - d]) return i - d;
        if (i + d < n && ready[i + d]) return i + d;
      }
      return drawnSrc;
    };

    /* ---- the loop ------------------------------------------------------------------------ */

    const kick = () => {
      if (raf === 0 && inView && !cancelled) raf = requestAnimationFrame(tick);
    };

    function tick(now: number) {
      raf = 0;
      const dt = Math.min(now - last, 64);
      last = now;

      const diff = target - current;
      if (Math.abs(diff) < 0.01) {
        current = target;
      } else {
        // Frame-rate normalised. A plain `current += diff * 0.16` eases twice as fast on a 120Hz
        // panel as on a 60Hz one, so the same flick reads differently per device.
        current += diff * (1 - Math.pow(1 - 0.16, dt / 16.667));
      }

      const want = Math.round(current);
      if (want !== drawnWant) {
        const src = nearestReady(want);
        if (src >= 0 && src !== drawnSrc) {
          const img = frames[src];
          if (img) {
            paint(img);
            drawnSrc = src;
          }
        }
        if (src === want) drawnWant = want;
      }

      if (current !== target) kick();
    }

    /* ---- scroll -> frame ----------------------------------------------------------------- */

    // Measured here and nowhere else. `tick` reads `scrollTop` and does arithmetic; no rect, no
    // offset, no computed style inside the loop, so the loop can never force a layout.
    const measure = () => {
      trackTop =
        track.getBoundingClientRect().top -
        scrollEl.getBoundingClientRect().top +
        scrollEl.scrollTop;
      // A viewport-height sticky stage inside a track of height H travels exactly H - stageH. So
      // p is 0 at the instant the hero pins and 1 at the instant it unpins, and the sequence
      // occupies the pinned run exactly rather than approximately.
      travel = Math.max(1, track.offsetHeight - stage.offsetHeight);
      onScroll();
    };

    const onScroll = () => {
      if (!inView) return;
      const p = (scrollEl.scrollTop - trackTop) / travel;
      target = (p < 0 ? 0 : p > 1 ? 1 : p) * (n - 1);
      kick();
    };

    /* ---- loading ------------------------------------------------------------------------- */

    /**
     * Stride-halving: 0, 16, 32... then 8, 24... then 4... down to every frame. After 8 requests
     * the entire scroll range has coverage every 16 frames, so combined with `nearestReady` a
     * scrub anywhere in the track is already approximately right rather than being right at the
     * start and blank everywhere else.
     */
    const loadOrder = () => {
      const out: number[] = [];
      const seen = new Uint8Array(n);
      for (let stride = 16; stride >= 1; stride >>= 1) {
        for (let i = 0; i < n; i += stride) {
          if (!seen[i]) {
            seen[i] = 1;
            out.push(i);
          }
        }
      }
      return out;
    };

    const order = loadOrder();
    // A quarter of the sequence is the end of the stride-4 pass: every point in the run is then
    // within two frames of something decoded, so the canvas goes live already scrubbable instead
    // of going live and then stuttering.
    const liveAt = Math.ceil(n / 4);
    let readyCount = 0;
    let cursor = 0;
    let inFlight = 0;
    let live = false;

    /**
     * A 1x1 scratch canvas, and the reason readiness is `onload` rather than `img.decode()`.
     *
     * **`decode()` cannot be relied on.** Measured in this app's own preview engine: the promise
     * *never settles* — not on a detached image, not on one appended to the document, not even
     * called after `onload` has already fired with `complete === true` and correct
     * `naturalWidth`/`naturalHeight`. A promise that never settles is not a slow path, it is a
     * deadlock: `inFlight` never decrements, the pump stops after six frames, and the sequence
     * sticks near frame 1 forever. That is the exact failure this whole component is specified
     * against, arriving through the API that is supposed to prevent it.
     *
     * So `onload` is the readiness signal, since it is universal and always fires. But `onload`
     * only means *decoded enough to know the dimensions* — the pixel decode can still happen
     * lazily at first `drawImage`, on the main thread, inside a scroll frame, which is the cost
     * `decode()` existed to move. Drawing each frame once into a 1x1 canvas at load time forces
     * that decode immediately and off the scroll path. One pixel of raster to buy a guaranteed
     * warm bitmap is the cheapest version of this there is.
     */
    const scratch = document.createElement("canvas");
    scratch.width = 1;
    scratch.height = 1;
    const scratchCtx = scratch.getContext("2d");

    const loadOne = (i: number) => {
      const img = new Image();
      img.decoding = "async";
      img.fetchPriority = "low";
      img.src = heroFrameUrl(tier, i);
      frames[i] = img;
      return new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error(`frame ${i}`));
      })
        .then(() => {
          if (cancelled) return;
          // Forces the pixel decode now rather than during a scroll frame. Wrapped because a
          // decode failure here must not be mistaken for a load failure — the frame is usable.
          try {
            scratchCtx?.drawImage(img, 0, 0, 1, 1);
          } catch {
            /* ignore — worst case is a lazy decode on first real draw */
          }
        })
        .then(() => {
          if (cancelled) return;
          ready[i] = 1;
          readyCount++;
          if (!live && readyCount >= liveAt) {
            live = true;
            onLiveRef.current();
          }
          // A late arrival can improve what is on screen, so give the loop one tick to notice.
          kick();
        })
        .catch(() => {
          // A 404 or a decode failure must drop the frame and keep the queue moving, or one bad
          // file stalls the whole sequence.
          frames[i] = null;
        });
    };

    const pump = () => {
      // Six in flight: the HTTP/1.1 ceiling, and on HTTP/2 it stops 120 low-priority images from
      // starving the fonts and the poster.
      while (!cancelled && inFlight < 6 && cursor < order.length) {
        const i = order[cursor++];
        inFlight++;
        void loadOne(i).finally(() => {
          inFlight--;
          if (!cancelled) pump();
        });
      }
    };

    /* ---- sizing -------------------------------------------------------------------------- */

    // Capped at 1.25, and this number is paired with the 1600px source in
    // `scripts/build-frame-sequence.mjs` — moving either alone breaks the pairing.
    //
    // It does two jobs. It holds down fill rate, which is not free here: every full-viewport
    // repaint re-rasters the navbar's backdrop-filter panel above it. And it keeps the
    // source-to-backing ratio near 1:1 — at 1.25 a 1440 CSS viewport gives an 1800px store, so a
    // 1600px frame upscales 1.13x. The first version of this shipped at 1.5 against a 1152px
    // source, i.e. a 2160px store fed by a soft 1152px image: a 1.88x upscale of already-blurred
    // pixels, which is most of why it read as mush. Raising the cap does not buy sharpness when
    // the source is the limit; it only costs fill rate.
    const DPR_CAP = 1.25;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const w = Math.round(stage.clientWidth * dpr);
      const h = Math.round(stage.clientHeight * dpr);
      if (!w || !h) return;
      // iOS fires this constantly as the URL bar collapses and `dvh` re-resolves. Bailing on a
      // no-op matters because the assignment below is destructive.
      if (w === canvas.width && h === canvas.height) {
        measure();
        return;
      }
      canvas.width = w;
      canvas.height = h;
      // Setting either dimension clears the canvas, so anything already drawn must be redrawn
      // now or the hero flashes black on every resize tick.
      const held = drawnSrc >= 0 ? frames[drawnSrc] : null;
      if (held) paint(held);
      measure();
    };

    /* ---- wiring -------------------------------------------------------------------------- */

    const ro = new ResizeObserver(resize);
    ro.observe(stage);

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (inView) {
          // Reset the clock, or a multi-second `dt` after time off screen makes the easing snap.
          last = performance.now();
          onScroll();
        } else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      // `root` must be the overlay: the document never scrolls, so a null root would observe a
      // viewport that never moves and the sequence would never start.
      { root: scrollEl, rootMargin: "10% 0px" },
    );
    io.observe(track);

    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", resize);
    resize();

    // The poster is the LCP element on the site's entry route and must win the network outright.
    // Deferring the pump behind idle is what keeps 120 frame requests from competing with it.
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(pump, { timeout: 2000 })
      : window.setTimeout(pump, 300);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle as number);
      else window.clearTimeout(idle as number);
      scrollEl.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resize);
      io.disconnect();
      ro.disconnect();
    };
  }, [scroller]);

  return <canvas ref={canvasRef} aria-hidden className="hero-frames" />;
}
