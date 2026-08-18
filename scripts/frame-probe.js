// Paste into the browser devtools console on any TripMate page, then leave the mouse alone.
//
// Exists because UI frame cost is the one thing this repo had no way to measure: `npm run
// perf-bench` measures LLM latency, and `npm test` never renders. Not wired into the app — a
// console paste, deliberately, so nothing ships to a visitor.
//
// Reports frames actually painted per second. The number that matters is IDLE: after the globe's
// drift eases out (~6.5s from last interaction), an idle page should paint ~0 fps. Before the
// render-on-demand work it painted continuously at display refresh, and every backdrop-filter
// panel over the canvas re-blurred on every one of those frames.
(() => {
  const SAMPLE_MS = 10_000;
  const frames = [];
  let last = performance.now();
  const t0 = last;

  console.log(`[frame-probe] sampling ${SAMPLE_MS / 1000}s — don't touch anything…`);

  (function tick(now) {
    frames.push(now - last);
    last = now;
    if (now - t0 < SAMPLE_MS) return requestAnimationFrame(tick);

    // rAF ticks even when nothing is painted, so rAF count alone would report ~60fps on a fully
    // idle page and prove nothing. Cesium's own frame counter is the honest signal.
    const v = window.__tripmateViewer;
    const sorted = [...frames].sort((a, b) => a - b);
    console.table({
      "rAF ticks/s (not paints)": +(frames.length / (SAMPLE_MS / 1000)).toFixed(1),
      "frame ms (median)": +sorted[Math.floor(sorted.length / 2)].toFixed(2),
      "frame ms (p95)": +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
      "frame ms (worst)": +sorted[sorted.length - 1].toFixed(2),
      "devicePixelRatio": window.devicePixelRatio,
      "canvas device px": v ? `${v.scene.canvas.width}x${v.scene.canvas.height}` : "no viewer",
      "requestRenderMode": v ? v.scene.requestRenderMode : "no viewer",
    });
    if (v) {
      // Count real paints over a second by hooking postRender, which only fires on rendered
      // frames — this is the before/after number.
      let painted = 0;
      const count = () => painted++;
      v.scene.postRender.addEventListener(count);
      setTimeout(() => {
        v.scene.postRender.removeEventListener(count);
        console.log(`[frame-probe] PAINTED FRAMES IN 1s WHILE IDLE: ${painted}`);
      }, 1000);
    }
  })(last);
})();
