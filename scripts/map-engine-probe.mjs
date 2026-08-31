// Side-by-side cost measurement for the two map engines. Run against a running server:
//
//   npm run dev                                   # or npm run build && npm start
//   node scripts/map-engine-probe.mjs             # both engines, /trip/latest
//   node scripts/map-engine-probe.mjs --path /    # some other surface
//   node scripts/map-engine-probe.mjs --headed    # real GPU, see the note below
//
// Not a dependency — driven by `npx playwright`, same as `scripts/browser-matrix.mjs`, because a
// 200MB engine download does not belong in package.json.
//
// WHAT THIS MEASURES, AND WHAT IT DOES NOT
//
// The honest signals here are the ones that do not depend on which GL backend the browser picked:
// bytes over the wire, requests, time to a first drawn map frame, JS heap, and — the one that
// matters most for this app — **painted frames while idle**. Every map frame forces every
// `backdrop-filter` glass panel above the canvas to re-blur, so a canvas that repaints when
// nothing is happening is the single most expensive thing on the page. Both engines are supposed
// to sit at ~0 there; this is what proves it.
//
// Frame *timings* under an interaction are reported too, but read them with care. Headless
// Chromium falls back to SwiftShader (software GL) unless the machine can give it a real context,
// in which case the numbers describe a CPU rasteriser and say nothing about a GPU. The probe
// prints the unmasked WebGL renderer string for exactly this reason — if it says "SwiftShader" or
// "llvmpipe", ignore every millisecond in the table and re-run with `--headed`.
//
// GPU *memory* is not readable from page JS at all. The closest honest proxy is bytes fetched plus
// the renderer's own reported tile/cache behaviour, both of which are here.
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const BASE = flag("--base", "http://localhost:3000");
const PATH = flag("--path", "/trip/latest");
const HEADED = args.includes("--headed");
/** How long to sit still before counting idle paints. The globe's drift eases out ~6.5s after the
 *  last interaction, so anything shorter measures the tail of a flight rather than idle. */
const SETTLE_MS = 9_000;
const IDLE_SAMPLE_MS = 3_000;
const INTERACTION_MS = 4_000;

/**
 * Injected before any app code runs.
 *
 * Two things are counted here, and the second is the important one.
 *
 * `frames` is rAF deltas — the page's own animation budget, which is what a dropped frame feels
 * like from the outside.
 *
 * `drawCalls` counts **WebGL draw calls**, by wrapping the four entry points every renderer
 * bottoms out in. It replaced a version that hooked Cesium's `postRender` and MapLibre's `render`
 * event through `window.__tripmateViewer` / `__tripmateMap`, which are dev-only handles — so the
 * single most important number in the comparison was unavailable in exactly the build worth
 * measuring. Draw calls need no handle, work identically on both engines, and answer the same
 * question: a canvas issuing zero draw calls is a canvas doing no GPU work.
 */
const INSTRUMENT = `
  window.__probe = { frames: [], drawCalls: 0, errors: [] };
  for (const proto of [self.WebGLRenderingContext, self.WebGL2RenderingContext]) {
    if (!proto) continue;
    for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
      const original = proto.prototype[name];
      if (!original) continue;
      proto.prototype[name] = function (...args) {
        window.__probe.drawCalls++;
        return original.apply(this, args);
      };
    }
  }
  const raf = window.requestAnimationFrame.bind(window);
  let last = performance.now();
  (function tick(now) {
    window.__probe.frames.push(now - last);
    last = now;
    raf(tick);
  })(last);
  window.addEventListener("error", (e) => window.__probe.errors.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => window.__probe.errors.push("rejection: " + e.reason));
`;

/**
 * One engine, start to finish. Returns a row for the comparison table.
 */
async function measure(engine) {
  const browser = await chromium.launch({
    headless: !HEADED,
    args: [
      // Ask for a real GL context rather than the software fallback. Honoured on a machine with a
      // usable GPU; ignored otherwise, which is what the renderer-string check below catches.
      "--ignore-gpu-blocklist",
      "--enable-gpu-rasterization",
      "--use-angle=default",
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Seeded into storage rather than left on the URL. `/trip/latest` answers with a 307 to the
  // real trip id and the redirect drops the query string, so `?map=` silently stopped applying
  // the moment the probe followed it — both runs measured whichever engine was the build default.
  await context.addInitScript(`try { localStorage.setItem("tripmateMapEngine", ${JSON.stringify(engine)}); } catch {}`);
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();

  // Bytes come from CDP, not from `content-length`.
  //
  // Cesium's 3D-tile and Ion responses are chunked and carry no `content-length` at all, so the
  // header-summing version reported 1.02MB for a run that made 832 requests — an order of
  // magnitude low, and low for exactly the engine that transfers the most. `encodedDataLength` on
  // `Network.loadingFinished` is what the browser actually pulled off the wire, compression
  // included.
  let bytes = 0;
  let requests = 0;
  const failures = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Performance.enable");
  cdp.on("Network.loadingFinished", ({ encodedDataLength }) => {
    if (Number.isFinite(encodedDataLength)) bytes += encodedDataLength;
  });
  page.on("response", (res) => {
    requests++;
    if (res.status() >= 400) failures.push(`${res.status()} ${res.url().slice(0, 120)}`);
  });
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e.message).slice(0, 200)));

  const startedAt = Date.now();
  await page.goto(`${BASE}${PATH}`, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // "The map is up" means a canvas exists and has been sized — the same gate the app's own
  // `ready` uses, reached from the outside.
  let bootMs = null;
  try {
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector("canvas");
        return !!canvas && canvas.width > 0 && canvas.height > 0;
      },
      { timeout: 45_000 }
    );
    bootMs = Date.now() - startedAt;
  } catch {
    bootMs = null;
  }

  const gl = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const ctx =
      canvas?.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ??
      canvas?.getContext("webgl");
    if (!ctx) return { renderer: "no context", vendor: "" };
    const ext = ctx.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "masked",
      vendor: ext ? String(ctx.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : "masked",
      drawingBuffer: `${ctx.drawingBufferWidth}x${ctx.drawingBufferHeight}`,
    };
  });

  // --- Interaction: a scripted drag across the map, which is the load the user actually feels.
  await page.mouse.move(360, 450);
  await page.mouse.down();
  const interactionStart = await page.evaluate(() => {
    window.__probe.frames.length = 0;
    return performance.now();
  });
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(360 + i * 12, 450 + Math.sin(i / 4) * 60);
    await page.waitForTimeout(INTERACTION_MS / 30);
  }
  await page.mouse.up();
  const interaction = await page.evaluate((from) => {
    const frames = window.__probe.frames.filter((f) => f > 0 && f < 500);
    const drawCalls = window.__probe.drawCalls;
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      count: frames.length,
      seconds: (performance.now() - from) / 1000,
      medianMs: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(2) : null,
      p95Ms: sorted.length ? +sorted[Math.floor(sorted.length * 0.95)].toFixed(2) : null,
      worstMs: sorted.length ? +sorted[sorted.length - 1].toFixed(2) : null,
      drawCalls,
    };
  }, interactionStart);

  // --- Idle: the number that actually governs this app's cost.
  await page.mouse.move(1200, 60); // off the map, so no hover peek is armed
  await page.waitForTimeout(SETTLE_MS);
  // Drain anything the settle itself drew, so the sample below starts from a genuinely still page.
  await page.evaluate(() => {
    window.__probe.drawCalls = 0;
  });
  const idle = await page.evaluate(async (sampleMs) => {
    // Zero draw calls over three still seconds is the pass condition. Both engines render on
    // demand — Cesium through `requestRenderMode`, MapLibre through its own repaint-on-change
    // loop — and every frame either of them paints forces every `backdrop-filter` glass panel
    // above the canvas to re-blur, which is the most expensive thing on this page.
    const before = window.__probe.drawCalls;
    const framesBefore = window.__probe.frames.length;
    await new Promise((r) => setTimeout(r, sampleMs));
    return {
      drawCallsPerSecond: +((window.__probe.drawCalls - before) / (sampleMs / 1000)).toFixed(1),
      rafPerSecond: +((window.__probe.frames.length - framesBefore) / (sampleMs / 1000)).toFixed(1),
    };
  }, IDLE_SAMPLE_MS);

  const heap = await page.evaluate(() =>
    performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null
  );
  // Main-thread cost, cumulative for the whole run. Not GPU time — nothing in a page can read
  // that — but it is where a heavy engine shows up second-most clearly after frame timing, and it
  // is the same clock for both engines.
  const metrics = Object.fromEntries(
    (await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value])
  );
  const probe = await page.evaluate(() => ({ errors: window.__probe.errors.slice(0, 5) }));

  await page.screenshot({ path: `/tmp/map-engine-${engine}.png` });
  await browser.close();

  return {
    engine,
    bootMs,
    requests,
    transferredMB: +(bytes / 1e6).toFixed(2),
    glRenderer: gl.renderer,
    drawingBuffer: gl.drawingBuffer,
    dragFps: interaction.count ? +(interaction.count / interaction.seconds).toFixed(1) : null,
    dragMedianMs: interaction.medianMs,
    dragP95Ms: interaction.p95Ms,
    dragDrawCallsPerSec: interaction.seconds
      ? Math.round(interaction.drawCalls / interaction.seconds)
      : null,
    idleDrawCallsPerSec: idle.drawCallsPerSecond,
    jsHeapMB: heap,
    mainThreadS: +(metrics.TaskDuration ?? 0).toFixed(1),
    scriptS: +(metrics.ScriptDuration ?? 0).toFixed(1),
    errors: [...new Set([...consoleErrors, ...probe.errors])].slice(0, 6),
    httpFailures: failures.slice(0, 6),
  };
}

const rows = [];
for (const engine of ["maplibre", "cesium"]) {
  process.stdout.write(`\n[probe] ${engine} …\n`);
  try {
    rows.push(await measure(engine));
  } catch (err) {
    rows.push({ engine, error: String(err).slice(0, 200) });
  }
}

console.log("\n=== map engine comparison ===");
console.table(
  rows.map((row) => {
    const { errors, httpFailures, ...rest } = row;
    void httpFailures;
    return { ...rest, errorCount: errors?.length ?? 0 };
  })
);
for (const row of rows) {
  if (row.errors?.length) console.log(`\n[${row.engine}] console errors:\n  ${row.errors.join("\n  ")}`);
  if (row.httpFailures?.length)
    console.log(`\n[${row.engine}] failed requests:\n  ${row.httpFailures.join("\n  ")}`);
}
console.log("\nScreenshots: /tmp/map-engine-maplibre.png, /tmp/map-engine-cesium.png");
if (rows.some((r) => /swiftshader|llvmpipe|software/i.test(r.glRenderer ?? ""))) {
  console.log(
    "\n!! Software GL detected — the frame-time columns describe a CPU rasteriser, not a GPU.\n" +
      "   Re-run with --headed for numbers that mean anything."
  );
}
