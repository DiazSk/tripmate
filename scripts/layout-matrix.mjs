// Layout regression gate. Run against a running PRODUCTION server:
//
//   npm run build && npm start -- -p 3200
//   npm run verify-layout [-- --base http://localhost:3200] [--only landing,planner,writing,trip,secondary]
//                         [--trip <id>] [--vp 390x844,...] [--out .layout-matrix] [--headed]
//
// Exits 1 and prints one `FAIL <surface> <WxH> <assertion>: <detail>` line per failing assertion
// per checkpoint, 0 when every assertion holds. Screenshots land in --out.
//
// WHY MEASURE INSTEAD OF LOOK. Every defect this gates was found by looking at one viewport and
// only existed at others: a footer taller than an 830px laptop, a planner summary sticky *under*
// the fixed nav, pins hidden behind the plan board, a "writing your plan" screen whose lede ran
// into its own footer. None throws, none logs, `tsc` and `npm test` see none of it.
//
// DEV MODE IS NOT REPRESENTATIVE: run it against `next start`. Dev serves unminified, un-split
// chunks and a different first paint, which moves exactly the things measured here.
//
// A FRESH CONTEXT PER SURFACE. The default --trip is a saved trip, readable only by a browser with
// no `tripmate_owner` cookie (a context that has already loaded the app has been issued one), so
// sharing a context across surfaces would turn a layout check into a 404. The writing surface
// stalls /api/itinerary on purpose, so it never spends a model call and writes no trip.
//
// Playwright is a devDependency here but drives the system Chrome (`channel: "chrome"`), so no
// browser download is needed. It needs network if Clerk dev keys are set (see CLAUDE.md).

import { chromium } from "playwright";
import fs from "node:fs";

const usage = (msg) => {
  console.error(`layout-matrix: ${msg}\nusage: node scripts/layout-matrix.mjs [--base URL] [--only landing,planner,writing,trip,secondary] [--trip ID] [--vp 390x844,...] [--out DIR] [--headed]`);
  process.exit(2);
};
const FLAGS = ["base", "only", "trip", "vp", "out"];
process.argv.slice(2).forEach((a) => { if (a.startsWith("--") && a !== "--headed" && !FLAGS.includes(a.slice(2))) usage(`unknown flag ${a}`); });
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined || v === "" || v.startsWith("--")) usage(`--${name} needs a value`);
  return v;
};
const BASE = arg("base", "http://localhost:3200").replace(/\/$/, "");
const OUT = arg("out", ".layout-matrix");
const TRIP = arg("trip", "095b4bb9-4fa1-4c6a-8959-81230e3996fd");
const ONLY = arg("only", "")?.split(",");
const VPS = arg("vp", "")?.split(","); // e.g. --vp 390x844,375x667; "" when absent
const CASE_MS = 150000; // one checkpoint of one surface, launch to close
const HEADED = process.argv.includes("--headed");

// [width, height, deviceScaleFactor]. 735x415 is 200% browser zoom on a 1470x830 Air.
const CHECKPOINTS = [
  [1920, 1080, 1], [1440, 900, 1], [1470, 830, 2], [1366, 768, 1], [1280, 800, 1],
  [1024, 768, 1], [768, 1024, 2], [390, 844, 3], [375, 667, 2], [735, 415, 1],
];

// Runs in the page, so it must be self-contained. What every surface must satisfy, as one entry
// per kind with the first few offenders.
function scan({ checkMonuments }) {
  const vw = innerWidth;
  const label = (el) => {
    const c = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const t = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 32);
    return `${el.tagName.toLowerCase()}${c} "${t}"`;
  };
  // checkVisibility covers display:none, visibility and opacity on the element AND its ancestors, so
  // content inside a section still fading in (GSAP) is not judged.
  const shown = (el) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const clips = (a) => /(hidden|clip)/.test(getComputedStyle(a).overflowX + getComputedStyle(a).overflowY);
  const scrolls = (a) => {
    const s = getComputedStyle(a);
    return (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight + 1) || (/(auto|scroll)/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1);
  };
  const inXScroller = (el) => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(a).overflowX) && a.scrollWidth > a.clientWidth + 1) return true;
    }
    return false;
  };
  // The ancestors whose overflow can clip `el`. A fixed element (or one inside a fixed bar, like the
  // nav sitting in the map shell's clipped box) is cut by none of them, an absolute one only by
  // those at or above its containing block.
  const clippers = function* (el) {
    let until = null;
    for (let n = el; n.parentElement; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === "fixed") return;
      if (pos === "absolute") until = n.offsetParent;
      const a = n.parentElement;
      if (until && a !== until) continue;
      until = null;
      yield a;
    }
  };
  const disjoint = (r, b) => r.top >= b.bottom - 1 || r.bottom <= b.top + 1 || r.left >= b.right - 1 || r.right <= b.left + 1;

  const found = { "x-outside": [], "partly-clipped": [], "sliced-text": [], "focusable-hidden": [] };
  const focusables = document.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[role="radio"],[role="tab"],[tabindex]:not([tabindex="-1"])');
  for (const el of focusables) {
    if (el.disabled) continue;
    // display:none (on it or any ancestor) and visibility:hidden mean not focusable at all.
    if (!el.checkVisibility({ visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    // F13: reachable by Tab, but inside something that hides it from the eye or the a11y tree.
    // tabindex < 0 and [inert] take an element out of the Tab order, which is the remedy, so they pass.
    let hiddenBy = null;
    if (el.tabIndex >= 0 && !el.closest("[inert]")) {
      hiddenBy = el.closest('[aria-hidden="true"]') ? "aria-hidden ancestor" : null;
      for (const a of clippers(el)) {
        if (hiddenBy || scrolls(a)) break;
        if (clips(a) && (a.getBoundingClientRect().height < 1 || disjoint(r, a.getBoundingClientRect()))) hiddenBy = `zero-height/disjoint ${label(a)}`;
      }
    }
    if (hiddenBy) { found["focusable-hidden"].push(`${label(el)} in ${hiddenBy}`); continue; }
    if (!shown(el)) continue;
    if (!inXScroller(el) && (r.right > vw + 1 || r.left < -1)) found["x-outside"].push(`${label(el)} ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`);
    for (const a of clippers(el)) {
      if (scrolls(a)) break;
      if (!clips(a)) continue;
      const ar = a.getBoundingClientRect();
      if (r.bottom > ar.bottom + 1 || r.top < ar.top - 1 || r.right > ar.right + 1 || r.left < ar.left - 1) {
        found["partly-clipped"].push(`${label(el)} by ${label(a)}`);
        break;
      }
    }
  }
  for (const el of document.querySelectorAll("body *")) {
    if (el.childElementCount || !el.textContent.trim() || !shown(el)) continue;
    // Monuments (the big condensed city name) are decorative. Skipped when the caller says so: the
    // writing screen's is flush with the screen's foot on purpose (line-height 1, pulled down 0.05em,
    // see WritingThePlan.css) so its line box crosses the container where its ink does not, and every
    // other monument (landing footer, trips and profile heroes) is scrubbed up by GSAP as it scrolls in
    // (motion.ts), so it crosses its section's foot mid-scroll and settles at 0. Everywhere but writing
    // they are checked in the settled first and last positions and skipped in the steps between.
    if (!checkMonuments && /monument/.test(el.className)) continue;
    const r = el.getBoundingClientRect();
    for (const a of clippers(el)) {
      if (scrolls(a)) break;
      if (!/(hidden|clip)/.test(getComputedStyle(a).overflowY)) continue;
      const ar = a.getBoundingClientRect();
      if (ar.height >= 2 && r.top < ar.bottom - 2 && r.bottom > ar.bottom + 2) found["sliced-text"].push(`${label(el)} crosses ${label(a)} by ${Math.round(r.bottom - ar.bottom)}px`);
      break;
    }
  }
  const out = Object.entries(found).filter(([, v]) => v.length).map(([kind, v]) => ({ kind, detail: `${v.length}: ${v.slice(0, 3).join("; ")}` }));
  const doc = document.documentElement;
  if (doc.scrollWidth > vw) out.push({ kind: "doc-x-overflow", detail: `scrollWidth ${doc.scrollWidth} > innerWidth ${vw}` });
  return out;
}

// Runs in the page (installed as window.freeMapRect). The largest rectangle left of the viewport
// once the nav and every element matching `selectors` are taken out, greedily: each occluder is
// cut away on whichever side leaves the most.
function freeMapRect(selectors) {
  const nav = document.querySelector("nav");
  let free = { l: 0, t: nav ? nav.offsetHeight : 0, r: innerWidth, b: innerHeight };
  const area = (f) => Math.max(0, f.r - f.l) * Math.max(0, f.b - f.t);
  for (const el of document.querySelectorAll(selectors)) {
    const o = el.getBoundingClientRect();
    if (!o.width || !o.height || getComputedStyle(el).visibility === "hidden") continue;
    if (o.right <= free.l || o.left >= free.r || o.bottom <= free.t || o.top >= free.b) continue;
    const cuts = [{ ...free, r: o.left }, { ...free, l: o.right }, { ...free, b: o.top }, { ...free, t: o.bottom }];
    free = cuts.reduce((best, c) => (area(c) > area(best) ? c : best));
  }
  return { ...free, area: area(free) };
}

async function enterPlanner(page) {
  // The nav's own button, not the footer form. It is the visible, on-screen, topmost `.polar-nav-cta`;
  // when none is (a phone, today) the menu's own copy takes over after opening the menu.
  const tag = () => page.evaluate(() => {
    document.querySelectorAll("[data-lm-cta]").forEach((e) => e.removeAttribute("data-lm-cta"));
    const b = [...document.querySelectorAll(".polar-nav-cta")].find((e) => {
      if (!e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return false;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === e || e.contains(top);
    });
    b?.setAttribute("data-lm-cta", "");
    return !!b;
  });
  if (!(await tag())) {
    await page.getByRole("button", { name: "Open menu" }).click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    if (!(await tag())) throw new Error("no clickable .polar-nav-cta, in the bar or in the menu");
  }
  await page.locator("[data-lm-cta]").click({ timeout: 8000 });
  await page.waitForTimeout(2500);
}

async function enterWriting(page) {
  // The request never resolves, so the screen stays on its first phase and no model call is made.
  await page.route("**/api/itinerary**", () => {});
  await page.locator(".tm-strip-hit").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Plan one like it" }).filter({ visible: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 6; i++) {
    const btn = page.getByRole("button", { name: /^(Next|Plan my trip)$/ }).filter({ visible: true }).first();
    const name = (await btn.textContent({ timeout: 8000 }))?.trim();
    await btn.click();
    await page.waitForTimeout(1500);
    if (name === "Plan my trip") break;
  }
  await page.waitForTimeout(1500);
}

const hits = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

async function checkLanding(page, w, h) {
  const fails = [];
  const fb = await page.evaluate(() => {
    const el = document.querySelector(".tm-fb");
    return el ? { h: Math.round(el.getBoundingClientRect().height), vh: innerHeight } : null;
  });
  // Only below 900px tall: at 1440x900 the landing must look unchanged, so a footer a little taller
  // than that viewport is the design's proportion; 735x415 is a zoom case, exempt by its width.
  if (w >= 1280 && h < 900) {
    if (!fb) fails.push(["footer-missing", "no .tm-fb: the footer rule cannot be measured"]);
    else if (fb.h > fb.vh) fails.push(["footer-taller-than-viewport", `.tm-fb is ${fb.h}px in a ${fb.vh}px viewport`]);
  }
  if (w < 640) {
    const ok = await page.evaluate(() =>
      [...document.querySelectorAll("nav button")].some((b) => {
        if (!/plan a trip/i.test(b.textContent) || !b.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
        const r = b.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.top < 0 || r.left < 0 || r.right > innerWidth || r.bottom > innerHeight) return false;
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); // not covered
        return top === b || b.contains(top);
      }),
    );
    if (!ok) fails.push(["no-plan-cta", `no visible "Plan a trip" button in nav at ${w}px wide`]);
  }
  return fails;
}

async function checkPlanner(page, w) {
  // `.content-overlay` is what scrolls here, not `.pp-page`.
  const m = await page.evaluate(async () => {
    if (!document.querySelector(".pp-page")) return { opened: false };
    document.querySelector(".content-overlay")?.scrollBy(0, 600);
    await new Promise((r) => setTimeout(r, 600));
    const r = document.querySelector(".pp-trip")?.getBoundingClientRect();
    return { opened: true, trip: r && r.height ? { top: Math.round(r.top) } : null, nav: document.querySelector("nav")?.offsetHeight ?? 0 };
  });
  if (!m.opened) return [["setup", "the planner did not open (.pp-page missing)"]];
  // The sticky summary is the planner's two-column layout, from 1100px (`min-[1100px]:grid`,
  // `.pp-main`); below it a non-sticky `.pp-trip-strip` stands in, so no `.pp-trip` is expected there.
  if (w < 1100) return [];
  if (!m.trip) return [["summary-missing", ".pp-trip is absent or empty at a width that has the two-column layout"]];
  return m.trip.top < m.nav ? [["summary-under-nav", `.pp-trip top ${m.trip.top}px < nav bottom ${m.nav}px after scrolling 600px`]] : [];
}

async function checkWriting(page, w) {
  const fails = [];
  const m = await page.evaluate(() => {
    const rect = (q) => { const r = document.querySelector(q)?.getBoundingClientRect(); return r && r.height ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null; };
    const seen = (q) => [...document.querySelectorAll(q)].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.checkVisibility({ opacityProperty: true, visibilityProperty: true }); });
    return { lede: rect(".wtp-lede"), foot: rect(".wtp-foot"), panel: seen(".docked-panel-collapsed"), controls: seen(".map-controls") };
  });
  if (!m.lede || !m.foot) fails.push(["lede-foot-overlap", `.wtp-lede or .wtp-foot not found (lede ${!!m.lede}, foot ${!!m.foot}): not on the writing screen`]);
  else if (hits(m.lede, m.foot)) fails.push(["lede-foot-overlap", `.wtp-lede bottom ${Math.round(m.lede.bottom)} runs into .wtp-foot top ${Math.round(m.foot.top)}`]);
  // A regression guard that cannot fail here: the docked panel's capsule appears only once stops
  // stream, and this request never resolves. Task 5 verifies the phone case with a real generation.
  if (w <= 760 && (m.panel || m.controls)) fails.push(["map-chrome-over-writing", `${[m.panel && ".docked-panel-collapsed", m.controls && ".map-controls"].filter(Boolean).join(" and ")} visible while writing`]);
  return fails;
}

async function checkTrip(page, w, h, shot) {
  const fails = [];
  const m = await page.evaluate(() => {
    const free = window.freeMapRect(".trip-board");
    const anchors = [...document.querySelectorAll(".stop-marker-layer .marker-anchor")];
    const outside = [];
    let hidden = 0;
    for (const a of anchors) {
      if (getComputedStyle(a).visibility !== "visible") { hidden++; continue; }
      const r = a.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < free.l || x > free.r || y < free.t || y > free.b) outside.push(`(${Math.round(x)},${Math.round(y)})`);
    }
    return { free, n: anchors.length, hidden, outside };
  });
  if (!m.n) fails.push(["markers-hidden", "no .marker-anchor rendered"]);
  else if (m.hidden) fails.push(["markers-hidden", `${m.hidden}/${m.n} .marker-anchor are visibility:hidden after 8s`]);
  if (m.outside.length) {
    const f = m.free;
    fails.push(["markers-outside-free-map", `${m.outside.length}/${m.n} outside free rect ${Math.round(f.l)},${Math.round(f.t)}..${Math.round(f.r)},${Math.round(f.b)}: ${m.outside.slice(0, 4).join(" ")}`]);
  }
  if (w >= 961) {
    const left = await page.evaluate(() => { const r = document.querySelector(".trip-board")?.getBoundingClientRect(); return r && r.width ? r.left : null; });
    if (left === null || left < w * 0.5) fails.push(["not-a-column", `.trip-board left edge ${left === null ? "missing" : Math.round(left)}px, wants >= ${w / 2}px`]);
  }
  if (w >= 1280) {
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(2500);
    if (!(await page.locator(".trip-spotlight").count())) {
      await page.locator(".tsl-closed").click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
    await shot("spotlight");
    const s = await page.evaluate(() => (document.querySelector(".trip-spotlight") ? window.freeMapRect(".trip-board, .trip-spotlight") : null));
    if (!s) fails.push(["spotlight-map-small", "spotlight did not open"]);
    else if (s.area < 0.55 * w * h) fails.push(["spotlight-map-small", `free map ${Math.round(s.r - s.l)}x${Math.round(s.b - s.t)} is ${Math.round((100 * s.area) / (w * h))}% of ${w}x${h}, wants >= 55%`]);
  }
  return fails;
}

const SURFACES = {
  landing: { paths: [["landing", "/"]], scroll: true, check: checkLanding },
  planner: { paths: [["planner", "/"]], enter: enterPlanner, check: checkPlanner },
  writing: { paths: [["writing", "/"]], enter: enterWriting, check: checkWriting, monuments: false },
  trip: { paths: [["trip", `/trip/${TRIP}`]], settle: 8000, check: checkTrip },
  secondary: { paths: [["trips", "/trips"], ["profile", "/profile"], ["signin", "/signin"], ["offline", "/offline"]], scroll: true },
};

if (ONLY[0] !== "" || ONLY.length > 1) ONLY.forEach((o) => !SURFACES[o] && usage(`--only: unknown surface "${o}" (have ${Object.keys(SURFACES).join(", ")})`));
const KNOWN_VPS = CHECKPOINTS.map(([w, h]) => `${w}x${h}`);
if (VPS[0] !== "" || VPS.length > 1) VPS.forEach((v) => !KNOWN_VPS.includes(v) && usage(`--vp: unknown checkpoint "${v}" (have ${KNOWN_VPS.join(", ")})`));

fs.mkdirSync(OUT, { recursive: true });
const failures = [];
let cases = 0;

for (const [group, s] of Object.entries(SURFACES)) {
  if (ONLY[0] !== "" && !ONLY.includes(group)) continue;
  for (const [surface, path] of s.paths) {
    for (const [w, h, dpr] of CHECKPOINTS) {
      const vp = `${w}x${h}`;
      if (VPS[0] !== "" && !VPS.includes(vp)) continue;
      const fail = (kind, detail) => { const line = `FAIL ${surface} ${vp} ${kind}: ${detail}`; failures.push(line); console.log(line); };
      cases++;
      console.log(`[${cases}] ${surface} ${vp}`);
      // A browser per case: after a few WebGL pages in one Chrome the whole process dies. Every case
      // has a deadline, and a stuck one fails with the step it was in rather than hanging the run.
      let browser, step = "launch", timer;
      const body = async () => {
        browser = await chromium.launch({ channel: "chrome", headless: !HEADED, timeout: 30000 });
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 640, hasTouch: w < 640 });
        const page = await ctx.newPage();
        const shot = (tag) => page.screenshot({ path: `${OUT}/${surface}-${vp}${tag ? "-" + tag : ""}.png`, timeout: 15000 });
        step = "goto";
        await page.addInitScript(`window.freeMapRect = ${freeMapRect.toString()}`);
        await page.goto(BASE + path, { waitUntil: "load", timeout: 30000 });
        step = "settle";
        await page.waitForTimeout(s.settle ?? 2500);
        step = "enter";
        if (s.enter) await s.enter(page);
        step = "screenshot";
        await shot();
        step = "scan";
        const seen = new Map();
        const add = (found) => found.forEach((f) => !seen.has(f.kind) && seen.set(f.kind, f.detail));
        const monuments = s.monuments !== false;
        const run = (checkMonuments) => page.evaluate(scan, { checkMonuments: checkMonuments && monuments });
        add(await run(true));
        if (s.scroll) {
          // Down the page until the scroller stops advancing: some things are only clipped where their
          // section is. Monuments are judged only where they have settled (first and last positions).
          step = "scroll";
          const at = () => page.evaluate(() => scrollY + (document.querySelector(".content-overlay")?.scrollTop ?? 0));
          for (let i = 0, prev = await at(); i < 60; i++) {
            await page.mouse.move(w / 2, h / 2);
            await page.mouse.wheel(0, Math.round(h * 0.85));
            await page.waitForTimeout(900);
            const now = await at();
            if (now === prev) { await page.waitForTimeout(1500); add(await run(true)); break; } // let scrubbed motion settle
            prev = now;
            add(await run(false));
          }
          await page.evaluate(() => { scrollTo(0, 0); document.querySelector(".content-overlay")?.scrollTo(0, 0); });
          await page.waitForTimeout(600);
        }
        seen.forEach((detail, kind) => fail(kind, detail));
        step = "check";
        if (s.check) for (const [k, d] of await s.check(page, w, h, shot)) fail(k, d);
      };
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("deadline")), CASE_MS); });
      try {
        await Promise.race([body(), deadline]);
      } catch (e) {
        if (e.message === "deadline") fail("timeout", `${step} (case over ${CASE_MS / 1000}s)`);
        else fail("setup", `${step}: ${String(e.message ?? e).split("\n")[0].slice(0, 200)}`);
      }
      clearTimeout(timer);
      await Promise.race([browser?.close(), new Promise((r) => setTimeout(r, 10000))]).catch(() => {});
      try { browser?.process()?.kill("SIGKILL"); } catch {}
    }
  }
}

if (!cases) usage("no checkpoint matched --only/--vp: nothing was checked");
console.log(failures.length ? `\n${failures.length} failing assertion(s) across ${cases} checkpoints. Screenshots in ${OUT}/` : `OK: ${cases} checkpoints, every assertion holds.`);
process.exit(failures.length ? 1 : 0);
