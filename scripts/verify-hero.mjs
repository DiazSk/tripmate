// Asserts the hero film actually works, against a running server.
//
//   npm run dev            # or: npm run build && npm start
//   npm run verify-hero
//
// Exits non-zero on the first failure, so it can front a commit.
//
// WHY THIS EXISTS
//
// Every defect this feature shipped with was **silent**. Not one threw, logged, or failed a build:
//
//   - `position: sticky` inside an `overflow-hidden` ancestor pins against a scrollport that never
//     scrolls. Renders identically to sticky never having been applied.
//   - `img.decode()`'s promise never settling. Deadlocks the load queue and holds the film near
//     frame 1 — which looks like slow footage, not a bug.
//   - `Cache-Control: immutable` on unversioned filenames. Serves a *previous* cut's bytes to
//     returning visitors only, so it is invisible to whoever is testing.
//   - `.hero-dusk`'s `--story` range being an absolute length, so a taller track finished the wash
//     a fifth of the way in and played the rest of the film behind a black rectangle.
//
// Every one was caught by somebody happening to measure the right thing. This script is the
// cheapest way to stop relying on that: 7 assertions over the properties whose failure is
// undetectable by eye on a fast machine.
//
// **Not wired into `npm run build`, and that is deliberate.** It needs a browser and a running
// server, and `scripts/browser-matrix.mjs` already records why Playwright is not a dependency here
// — a 200MB engine download does not belong in package.json for a repo with no CI. Run it by hand
// when touching `Hero`, `HeroFrames`, the `.hero-*` rules, or the frame pipeline. `verify-build.mjs`
// stays the automatic gate; this is the manual one.
//
//   npx playwright install chromium      # once

import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = process.env.HERO_BASE_URL ?? "http://localhost:3000";

/** Read the generated manifest rather than hardcoding — the point is to catch it drifting. */
function manifest() {
  const src = readFileSync(path.join(ROOT, "src/components/blue-hour/heroSequence.ts"), "utf8");
  const frames = Number(src.match(/frames:\s*(\d+)/)?.[1]);
  const version = src.match(/petra\/([a-f0-9]+)\//)?.[1];
  const format = src.match(/\.\$\{FORMAT\}|\.(avif|webp)`/)?.[1] ?? src.match(/\.(avif|webp)`/)?.[1];
  if (!frames || !version) throw new Error("could not parse heroSequence.ts");
  return { frames, version, format };
}

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

async function main() {
  const { frames, version } = manifest();
  console.log(`hero film: ${frames} frames, version ${version}`);
  console.log(`target:    ${BASE}\n`);

  const browser = await chromium.launch();

  /* ---- the normal path -------------------------------------------------------------------- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const served = new Set();
  const failed = [];
  page.on("response", (r) => {
    const u = r.url();
    if (!/\/scenes\/petra\/.+\/(land|port)-\d+\./.test(u)) return;
    served.add(u);
    if (!r.ok()) failed.push(`${r.status()} ${u.split("/").pop()}`);
  });

  await page.goto(BASE, { waitUntil: "load" });

  // 1. The pin exists at all. Cheapest possible check and it is the one that has failed.
  const position = await page.$eval(".hero-stage", (el) => getComputedStyle(el).position);
  check("stage computes position: sticky", position === "sticky", `got ${position}`);

  // 2. The film reaches `live`. Covers the whole load path — fetch, decode readiness, the
  //    `onLive` callback, the CSS that fades the canvas in. `img.decode()` never settling failed
  //    exactly here while everything upstream looked healthy.
  let live = true;
  try {
    await page.waitForFunction(
      () => document.querySelector(".hero-track")?.dataset.seq === "live",
      null,
      { timeout: 25_000 },
    );
  } catch {
    live = false;
  }
  const seq = await page.$eval(".hero-track", (el) => el.dataset.seq ?? "(unset)");
  check("film reaches data-seq=live", live, `data-seq=${seq}`);

  // 3. The pin holds under scroll. `window` never scrolls here, so this drives the real scroller.
  const pin = await page.evaluate(async () => {
    const sc = document.querySelector(".content-overlay");
    const track = document.querySelector(".hero-track");
    const stage = document.querySelector(".hero-stage");
    const travel = track.offsetHeight - stage.offsetHeight;
    const off = [];
    for (const f of [1 / 3, 2 / 3]) {
      sc.scrollTop = Math.round(travel * f);
      await new Promise((r) => setTimeout(r, 400));
      off.push(
        Math.round(stage.getBoundingClientRect().top - sc.getBoundingClientRect().top),
      );
    }
    sc.scrollTop = 0;
    return { travel, off };
  });
  check(
    "stage stays flush while pinned",
    pin.off.every((o) => Math.abs(o) < 2),
    `offsets ${pin.off.join(", ")}px over ${pin.travel}px of travel`,
  );

  // 4. Every frame the manifest promises is actually served, and none 404s. Catches a manifest
  //    that outran the encode, or a version directory that was never committed.
  check(
    `all ${frames} frames served, none failing`,
    served.size >= frames && failed.length === 0,
    `${served.size} served${failed.length ? `, failures: ${failed.slice(0, 3).join(", ")}` : ""}`,
  );

  // 5. The served path carries the manifest's version. This is what makes the `immutable` header
  //    honest; a mismatch means a returning visitor can be handed a previous cut's bytes.
  const wrongVersion = [...served].filter((u) => !u.includes(`/${version}/`));
  check(
    "served frames match the manifest version",
    wrongVersion.length === 0,
    wrongVersion.length ? `${wrongVersion.length} from another version` : version,
  );

  // 6. The film advances *and* clamps. Three canvas fingerprints: start and end must differ (it
  //    moves at all), and scrolling past the end must not change it (progress is clamped, not
  //    running off the end of the array).
  const motion = await page.evaluate(async () => {
    const sc = document.querySelector(".content-overlay");
    const track = document.querySelector(".hero-track");
    const stage = document.querySelector(".hero-stage");
    const cv = document.querySelector(".hero-frames");
    const travel = track.offsetHeight - stage.offsetHeight;
    const fingerprint = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 8;
      c.getContext("2d").drawImage(cv, 0, 0, 8, 8);
      return [...c.getContext("2d").getImageData(0, 0, 8, 8).data].reduce(
        (a, b) => (a * 31 + b) % 1e9,
        7,
      );
    };
    const at = async (top) => {
      sc.scrollTop = top;
      await new Promise((r) => setTimeout(r, 900));
      return fingerprint();
    };
    return { start: await at(0), end: await at(travel), past: await at(travel + 600) };
  });
  check("film advances between endpoints", motion.start !== motion.end);
  check("progress clamps at the end", motion.end === motion.past);

  await ctx.close();

  /* ---- the opt-out paths ------------------------------------------------------------------ */
  // Both of these must collapse the track to one viewport. If either regresses, the visitor is
  // made to scroll three empty viewports past a still image — or, for reduced-data, is charged
  // ~10MB after asking not to be.
  const trackHeight = async (contextOptions, initScript) => {
    const c = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ...contextOptions,
    });
    const p = await c.newPage();
    if (initScript) await p.addInitScript(initScript);
    await p.goto(BASE, { waitUntil: "load" });
    await p.waitForTimeout(2500);
    const out = await p.evaluate(() => {
      const t = document.querySelector(".hero-track");
      return { h: t.offsetHeight, seq: t.dataset.seq ?? null, vh: window.innerHeight };
    });
    await c.close();
    return out;
  };

  const rm = await trackHeight({ reducedMotion: "reduce" });
  check(
    "prefers-reduced-motion collapses the track",
    rm.h <= rm.vh + 1 && rm.seq === null,
    `${rm.h}px vs ${rm.vh}px viewport, data-seq=${rm.seq}`,
  );

  // Playwright cannot emulate `prefers-reduced-data`, so stub the Network Information API the way
  // Data Saver reports it. This exercises the same predicate the media query feeds.
  const rd = await trackHeight({}, () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true, effectiveType: "4g", addEventListener() {}, removeEventListener() {} },
    });
  });
  check(
    "saveData collapses the track",
    rd.h <= rd.vh + 1 && rd.seq === null,
    `${rd.h}px vs ${rd.vh}px viewport, data-seq=${rd.seq}`,
  );

  await browser.close();

  const bad = results.filter((r) => !r.pass);
  console.log("");
  if (bad.length) {
    console.log(`verify-hero: ${bad.length} of ${results.length} checks FAILED`);
    process.exit(1);
  }
  console.log(`verify-hero: ${results.length} checks passed`);
}

await main();
