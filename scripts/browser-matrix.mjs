// Cross-engine compatibility + boot check. Run against a running server:
//
//   npm run build && npm start          # or: npm run dev
//   node scripts/browser-matrix.mjs
//
// Not a dependency — driven by `npx playwright`, because this is a diagnostic nobody
// runs in CI here and a 200MB engine download does not belong in package.json.
//   npx playwright install chromium firefox webkit
//
// WHAT THIS CAN AND CANNOT TELL YOU
//
// It answers *compatibility*: does the page boot, does WebGL2 come up, did the glass
// actually get a backdrop-filter, did `:has()` apply, did anything throw.
//
// It does NOT answer *GPU performance*. Playwright's WebKit on Windows is a port with a
// software/ANGLE GL path — it is not Safari on Apple silicon, and its frame timings say
// nothing about a real iPhone. This app's whole cost is GPU (a WebGL globe plus large
// backdrop-filter surfaces sampling it), which is exactly the thing that does not
// transfer between engine ports. Frame rate has to come from real devices; use
// scripts/frame-probe.js there.
// TWO KNOWN FALSE ALARMS, so nobody re-investigates them:
//
// 1. WebKit reports `ReferenceError: Can't find variable: OffscreenCanvas` and fails to
//    construct the Cesium widget. Playwright's WebKit build genuinely lacks OffscreenCanvas
//    (verified: `typeof OffscreenCanvas === "undefined"`), but real Safari has shipped it since
//    16.4 — and this project's browserslist floor is far above that. It is a limitation of the
//    port, not a Safari bug. The corollary is the uncomfortable one: this script cannot confirm
//    Safari works either. Only a real Apple device can.
//
// 2. Chromium logs `net:` lines for `?_rsc=` URLs. Those are Next's RSC prefetches being
//    aborted when the page closes; requested directly they return 200.

import { chromium, firefox, webkit } from "playwright";

const BASE = process.env.MATRIX_BASE_URL ?? "http://localhost:3000";
const ROUTES = ["/", "/trips", "/profile", "/trip/latest"];
const ENGINES = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

/** Runs in the page. Reports what actually took effect, not what the source asked for. */
function probe() {
  const err = (window.__matrixErrors ??= []);
  const glass = [...document.querySelectorAll("*")].find((e) => {
    const v = getComputedStyle(e).backdropFilter;
    return v && v !== "none";
  });
  // `:has()` here drives whether the map control stack is hidden. An engine without it
  // leaves working-but-pointless controls on screen — cosmetic, not fatal, but visible.
  let hasSupport = false;
  try {
    hasSupport = CSS.supports("selector(:has(*))");
  } catch {}
  const canvas = document.querySelector("canvas");
  let gl = null;
  if (canvas) {
    try {
      gl = canvas.getContext("webgl2") ? "webgl2" : canvas.getContext("webgl") ? "webgl1" : null;
    } catch {}
  }
  const paint = performance.getEntriesByType("paint");
  return {
    title: document.title,
    glassApplied: glass ? getComputedStyle(glass).backdropFilter.slice(0, 34) : null,
    hasSelector: hasSupport,
    dvhSupported: CSS.supports("height", "100dvh"),
    abortTimeout: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function",
    structuredClone: typeof structuredClone === "function",
    dialogModal: typeof HTMLDialogElement !== "undefined" &&
      typeof HTMLDialogElement.prototype.showModal === "function",
    webgl: gl,
    // NOT `window.__tripmateViewer` — that handle is deliberately dev-only and stripped from
    // production builds, so it reports false on exactly the bundle this script exists to check.
    //
    // And not the canvas alone either: Cesium builds its widget DOM *before* it can fail, so a
    // crashed viewer still leaves a `.cesium-widget canvas` behind. Checking only for that
    // reported a healthy globe on WebKit while construction was throwing. The error panel is
    // Cesium's own signal that it gave up, so a boot is the canvas present AND that absent.
    cesiumBooted:
      !!document.querySelector(".cesium-widget canvas") &&
      !document.querySelector(".cesium-widget-errorPanel"),
    fcpMs: Math.round(paint.find((p) => p.name === "first-contentful-paint")?.startTime ?? -1),
    // The navbar's cell structure. It has no other coverage anywhere — nothing in `npm test`
    // renders a component — and its one shipped bug was a per-route inconsistency: the wordmark's
    // vertical rule was gated on there being links to divide from, so `/profile` rendered a bare
    // strip while every sibling rendered a ruled grid. That class of defect is exactly what a
    // per-route probe catches. `navCells` is 3 on a user-facing route and 2 on the internal
    // dashboards and the 404; `navTrailing` counts *visible* controls in the last cell and must be
    // 1 wherever there are 3 cells — 2 would mean a display utility silently lost to Tailwind's
    // alphabetical emission order, which is how `hidden` on an already-`inline-flex` link fails.
    // Still desktop-only, like everything else here: the toggle and the panel are never exercised.
    // Scoped to `.glass-nav`, not a bare `nav`: the landing renders an unclassed, childless <nav>
    // earlier in the DOM, so the generic selector reported 0 cells on `/`.
    navCells: (() => {
      const nav = document.querySelector("nav.glass-nav");
      if (!nav) return null;
      return [...nav.children].filter((c) => c.tagName === "DIV" && c.id !== "nav-menu").length;
    })(),
    navTrailing: (() => {
      const nav = document.querySelector("nav.glass-nav");
      const cells = nav
        ? [...nav.children].filter((c) => c.tagName === "DIV" && c.id !== "nav-menu")
        : [];
      const last = cells[cells.length - 1];
      return last
        ? [...last.querySelectorAll("a,button")].filter((e) => e.getClientRects().length > 0).length
        : null;
    })(),
    // The hero's sticky pin, and this belongs here rather than in a unit test because its
    // failure is *silent* and cross-engine. `.hero-stage` pins against `.content-overlay`, and
    // that only works while no element between them sets `overflow`, `contain` or
    // `content-visibility` — add any of those to `<main>` or to ScrollStory's wrapper and the
    // stage simply scrolls away with nothing logged anywhere. This harness exists to answer "did
    // the CSS actually take effect", which is exactly the shape of that question.
    //
    // `heroPinned` is the real assertion: after scrolling a third of the way into the track, the
    // stage's top must still be flush with the scroller's top. A 2px tolerance absorbs subpixel
    // rounding. `null` means the sequence is not running (no `data-seq`), which is the correct
    // state for a reduced-motion run rather than a failure.
    heroStagePosition: (() => {
      const stage = document.querySelector(".hero-stage");
      return stage ? getComputedStyle(stage).position : null;
    })(),
    heroPinned: (() => {
      const track = document.querySelector(".hero-track");
      const stage = document.querySelector(".hero-stage");
      const scroller = document.querySelector(".content-overlay");
      if (!track || !stage || !scroller || !track.dataset.seq) return null;
      const before = scroller.scrollTop;
      scroller.scrollTop = Math.round(track.offsetHeight / 3);
      const flush =
        Math.abs(stage.getBoundingClientRect().top - scroller.getBoundingClientRect().top) < 2;
      scroller.scrollTop = before;
      return flush;
    })(),
    errors: err.slice(0, 6),
  };
}

const rows = [];
for (const [name, engine] of ENGINES) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    rows.push({ engine: name, route: "—", note: `engine unavailable: ${String(e).split("\n")[0]}` });
    continue;
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
    page.on("requestfailed", (r) => errors.push(`net: ${r.url().slice(0, 60)}`));
    try {
      await page.goto(BASE + route, { waitUntil: "load", timeout: 45_000 });
      // The globe boots behind a dynamic import and a tileset fetch; give it room.
      await page.waitForTimeout(6_000);
      await page.evaluate((e) => (window.__matrixErrors = e), errors);
      rows.push({ engine: name, route, ...(await page.evaluate(probe)) });
    } catch (e) {
      rows.push({ engine: name, route, note: `FAILED: ${String(e).split("\n")[0].slice(0, 90)}` });
    }
    await page.close();
  }
  await browser.close();
}

const yn = (v) => (v === true ? "yes" : v === false ? "NO" : v ?? "—");
console.log(
  "\nengine    route         title/note                    glass  :has  webgl   cesium  nav   pin   FCP"
);
console.log("-".repeat(116));
for (const r of rows) {
  if (r.note) {
    console.log(`${r.engine.padEnd(9)} ${String(r.route).padEnd(13)} ${r.note}`);
    continue;
  }
  console.log(
    `${r.engine.padEnd(9)} ${r.route.padEnd(13)} ${String(r.title).slice(0, 28).padEnd(28)} ` +
      `${(r.glassApplied ? "yes" : "NO").padEnd(6)} ${yn(r.hasSelector).padEnd(5)} ` +
      `${yn(r.webgl).padEnd(7)} ${yn(r.cesiumBooted).padEnd(7)} ` +
      `${`${r.navCells ?? "?"}/${r.navTrailing ?? "?"}`.padEnd(5)} ` +
      // "—" means the sequence is not running on this route, which is correct everywhere but `/`.
      // "NO" is a real failure: the stage exists, the track is grown, and it did not stick.
      `${(r.heroPinned === null ? "—" : r.heroPinned ? "yes" : "NO").padEnd(5)} ${r.fcpMs}ms`
  );
  if (r.errors?.length) r.errors.forEach((e) => console.log(`${" ".repeat(10)}  ! ${e.slice(0, 88)}`));
}

console.log("\nJS API support (a missing one is a hard crash, not a degrade):");
for (const r of rows.filter((r) => !r.note && r.route === "/")) {
  console.log(
    `  ${r.engine.padEnd(9)} AbortSignal.timeout=${yn(r.abortTimeout)}  structuredClone=${yn(
      r.structuredClone
    )}  dialog.showModal=${yn(r.dialogModal)}  dvh=${yn(r.dvhSupported)}`
  );
}
console.log("\nFrame rate is deliberately absent — see the header comment. Use frame-probe.js on real hardware.\n");
