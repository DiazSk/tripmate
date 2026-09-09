/**
 * Turns a source video into the two WebP tiers `HeroSequence` scrubs.
 *
 * Run by hand, not at postinstall — the input is a 13.5MB MP4 that deliberately never enters git
 * (see .gitignore), and the outputs are committed. So this runs once when the footage changes and
 * its product is a reviewable diff, rather than running on every clone against a file that is not
 * there.
 *
 *     node scripts/build-frame-sequence.mjs
 *     node scripts/build-frame-sequence.mjs --frames 96 --dry-run
 *     node scripts/build-frame-sequence.mjs --source assets/scene-source/other.mp4
 *
 * **Frames come from AVFoundation, not from ezgif, and that is a quality decision.** The first
 * version of this read a zip of PNGs exported by ezgif, and carried a CRC-based deduplicator
 * because ezgif had written 24fps source into a 30fps container: 300 entries of which 60 were
 * byte-identical repeats, on a 5n+3 stride. A naive every-Nth walk landed on those repeats and the
 * scrub visibly stalled — the frame index advanced while the picture did not. It had also been
 * through an extra compression generation before we ever saw it.
 *
 * `scripts/extract-frames.swift` decodes the original H.264 once and returns the exact frame at
 * the exact presentation time, losslessly, so all of that disappears: no duplicates to detect, no
 * intermediate encode, and the frame count is whatever the file actually holds. The dedupe check
 * below is kept as an assertion rather than a repair.
 *
 * Two decode passes, deliberately. Selecting frames needs to see all of them (the
 * equal-visual-change curve), but only the chosen ~100 need full resolution — and 240 frames of
 * 1920x1080 PNG is 1.2GB of scratch. So pass one extracts every frame at 320px for analysis, and
 * pass two extracts only the survivors at native size.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXTRACTOR = path.join(ROOT, "scripts/extract-frames.swift");
const OUT_ROOT = path.join(ROOT, "public/scenes/petra");

/**
 * Two tiers, and the portrait one is a different *crop*, not just a smaller copy.
 *
 * A 16:9 frame cover-fitted into a 9:16 viewport keeps 27% of the source width — on a phone the
 * canyon walls fill the screen and the Treasury they frame is gone. So portrait viewports get a
 * centre crop encoded at 9:16. The shot is a dolly straight down the Siq, so its subject is dead
 * centre in every frame by construction and a centre crop cannot lose it.
 *
 * **No pre-blur, and the version that had one was a mistake worth recording.** These frames
 * shipped once at 1152x648 with a 1.0px blur, on the argument that the grain was costing bytes
 * and the softness would be invisible behind `.hero-scrim`. The first half was true — quality
 * alone cannot compress this footage, because dropping WebP quality from 72 to 36 saves only 33%,
 * which is the signature of a noisy render spending its bits on grain rather than picture. The
 * second half was wrong: at real viewing size it read as mush, and it compounded with the canvas
 * upscaling a 1152px source into a 2160px retina backing store. **Sharpen the source and match
 * the backing store instead; never soften the source to save bytes.**
 *
 * 1600 wide is chosen against `HeroFrames`' `DPR_CAP` of 1.25: a 1440 CSS viewport gives an
 * 1800px backing store, so the upscale is 1.13x rather than the 1.88x that caused the problem.
 * The two numbers are a pair — moving one without the other reintroduces it.
 *
 * One landscape tier rather than two: a second would double what git carries for a difference
 * nobody can point at.
 *
 * **AVIF, not WebP, and the decision reversed on measurement.** AVIF was tested and rejected on
 * the previous footage, where it only beat WebP below q52 and was *larger* at q60 — because that
 * clip was noise-dominated, and noise is the one thing AVIF has no advantage on. This footage
 * carries real detail instead (edge energy 36 against the old 27 median), which is exactly where
 * AVIF wins: 1600x900 costs 94KB at q44 against WebP's 163KB, a 37% saving, and at 1:1 against a
 * q88 reference the carved frieze, the capitals and the rock striations are indistinguishable.
 * Same conclusion, opposite answer, because the input changed — re-measure per clip rather than
 * inheriting the verdict.
 *
 * The `browserslist` floor is Safari 16.4 / iOS 16.4, which is precisely the release AVIF landed
 * in, so every browser this project declares support for can decode these. A browser that cannot
 * degrades correctly rather than badly: the frames fail to load, `data-seq` never reaches "live",
 * the track stays one viewport and the poster is the hero — the same path reduced-motion takes.
 */
const TIERS = [
  { name: "land", width: 1600, height: 900, quality: 44 },
  { name: "port", width: 540, height: 960, quality: 50 },
];

/** File extension and encoder, kept together so the manifest and the encoder cannot disagree. */
const FORMAT = "avif";

/** How many frames sharp encodes at once. Each holds a decoded 1920x1080 RGB buffer (~6MB) plus
 *  the compressed PNG, so this is a memory ceiling, not a CPU one. */
const CONCURRENCY = 6;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const FRAME_COUNT = Number(flag("frames", 100));
const DRY_RUN = args.includes("--dry-run");
const SOURCE = path.resolve(
  ROOT,
  flag("source", "assets/scene-source/Camera_moving_toward_Petra_Treasury_20260909155546.mp4"),
);
/** Scratch for the two decode passes. Removed on the way out, including on failure. */
const TMP = path.join(os.tmpdir(), `hero-frames-${process.pid}`);

/**
 * The window, as 1-based frame numbers. The whole reel by default: the film opens inside the cave
 * and ends on the facade.
 *
 * **A previous cut started at 86 and that was wrong.** The reasoning was that the opening frames
 * are nearly static — the camera really does move slowly there — so they bought little scroll
 * travel. But that section is the cave, which is the reason for using this footage at all. If this
 * window is ever narrowed again, narrow it from the end.
 */
const FROM = Number(flag("from", 1));
const TO = Number(flag("to", 240));

/**
 * Frame ranges to drop, as `[first, last]` pairs of 1-based frame numbers. **Empty, and the reason
 * it is empty is the point.**
 *
 * The previous footage needed `[[72, 78]]`: a double-exposure zone where the render morphed and the
 * canyon walls changed identity mid-shot. Measuring it took three attempts, because the metric
 * being used — edge energy — is blind to the defect. Morphing geometry keeps its *texture* sharp
 * while its *structure* drifts, so those frames scored 34-35 against a 27 median, i.e. the
 * crispest in the reel, while being the broken ones.
 *
 * The metric that actually sees it is rigidity: block-match consecutive frames, fit a radial
 * expansion (which is what a forward dolly produces), and measure the residual. Measured on both
 * clips at identical spacing — old footage median 0.541px with 94 of 120 pairs above 0.4px; this
 * one median 0.095px with **0 of 120** above it. 5.7x more rigid. So nothing needs excluding, and
 * the check to run after any new footage lands is that one, not edge energy.
 */
const EXCLUDE = [];

/**
 * A content version baked into the URL path, and it is what makes the `immutable` cache header in
 * `next.config.ts` honest.
 *
 * The first version of this shipped `immutable` against fixed filenames — `land-001.webp` and so
 * on — with a comment claiming that was safe because the script rewrites the whole directory. That
 * was wrong, and it was caught by this exact script's second run: `immutable` tells the browser
 * never to revalidate, so a returning visitor kept serving the *previous* cut's bytes from a URL
 * whose name had not changed. Measured at the time: 74,022 cached bytes against 77,002 on the
 * server. The failure mode in production is worse than a stale image — a re-cut would serve a
 * visitor a *mixture* of two edits, and only visitors who had been before would see it.
 *
 * So the path carries a hash of everything that determines the output. Change the window, the
 * frame count, a tier, or the source footage, and every URL changes with it.
 */
const VERSION = createHash("sha256")
  .update(JSON.stringify({ FROM, TO, FRAME_COUNT, TIERS, EXCLUDE, FORMAT }))
  .update(readFileSync(SOURCE))
  .digest("hex")
  .slice(0, 8);
const OUT_DIR = path.join(OUT_ROOT, VERSION);

/** Shape of the source file, without decoding a single frame. */
function probeVideo(video) {
  const out = execFileSync("swift", [EXTRACTOR, video, TMP, "probe"], {
    encoding: "utf8",
    maxBuffer: 1 << 20,
  });
  return JSON.parse(out.trim().split("\n").pop());
}

/**
 * Extracts frames to `dir`. `indices` is 0-based, or "all". `maxWidth` downscales for the
 * analysis pass — the extractor asks AVFoundation for the smaller image rather than decoding
 * full-size and shrinking, so pass one is cheap.
 */
function extract(video, dir, indices, maxWidth) {
  const spec = indices === "all" ? "all" : indices.join(",");
  const argv = [EXTRACTOR, video, dir, spec];
  if (maxWidth) argv.push(String(maxWidth));
  execFileSync("swift", argv, { encoding: "utf8", maxBuffer: 8 << 20 });
}

const framePath = (dir, i) => path.join(dir, `frame-${String(i + 1).padStart(4, "0")}.png`);

/**
 * An assertion, not a repair. The ezgif path needed to *remove* duplicates; a clean 24fps decode
 * should have none, and if it ever does that means the source itself is padded and the frame
 * count is a lie — worth failing loudly rather than silently scrubbing through a stall.
 */
function assertNoDuplicates(dir, count) {
  const seen = new Map();
  for (let i = 0; i < count; i++) {
    const h = createHash("md5").update(readFileSync(framePath(dir, i))).digest("hex");
    if (seen.has(h)) {
      throw new Error(
        `frames ${seen.get(h) + 1} and ${i + 1} are byte-identical — the source is padded, ` +
          `so its frame count overstates how much motion it actually holds`,
      );
    }
    seen.set(h, i);
  }
}

/**
 * Samples at equal *visual change* rather than at equal frame index, which is what makes the
 * scrub feel like one continuous camera move.
 *
 * The camera in this footage does not travel at a constant rate: measured across the sequence,
 * consecutive-frame difference swings from 1 to 15 — a 14x spread. Sampling evenly by index and
 * mapping that linearly to scroll means the picture crawls where the camera crawls and rips where
 * it accelerates, which is most of what read as awkward.
 *
 * So: build a cumulative curve of how much the picture changes through the window, then place the
 * output frames at equal steps along *that* curve. Each output frame then carries the same amount
 * of change, so a constant scroll speed produces a constant rate of change. The effect is to keep
 * most frames through the fast section and decimate the parts where the camera nearly stops.
 *
 * Both endpoints stay exact — they are the two frames the scrub is guaranteed to rest on.
 */
async function sampleByVisualChange(dir, frames, count) {
  if (count >= frames.length) return frames;

  // 48x27 greyscale is enough to measure camera motion and cheap enough to run over the whole
  // window: it is the same grid the diagnosis used.
  const grids = [];
  for (const f of frames) {
    grids.push(
      await sharp(framePath(dir, f)).resize(48, 27, { fit: "fill" }).greyscale().raw().toBuffer(),
    );
  }

  const cum = [0];
  for (let i = 1; i < grids.length; i++) {
    let d = 0;
    for (let p = 0; p < 48 * 27; p++) d += Math.abs(grids[i][p] - grids[i - 1][p]);
    cum.push(cum[i - 1] + d / (48 * 27));
  }

  const total = cum[cum.length - 1];
  const picked = [];
  let cursor = 0;
  for (let j = 0; j < count; j++) {
    const target = (j * total) / (count - 1);
    while (cursor < cum.length - 1 && cum[cursor + 1] < target) cursor++;
    // Nearest of the two straddling frames, and never step backwards — a flat stretch can leave
    // several frames at the same cumulative value, and picking the same frame twice would show as
    // a stall in the scrub.
    let k = cursor;
    if (cursor + 1 < cum.length && Math.abs(cum[cursor + 1] - target) < Math.abs(cum[cursor] - target)) k = cursor + 1;
    if (picked.length && k <= picked[picked.length - 1]) k = picked[picked.length - 1] + 1;
    if (k > frames.length - 1) k = frames.length - 1;
    picked.push(k);
  }
  // The last output frame must be the window's last frame, whatever the rounding did.
  picked[picked.length - 1] = frames.length - 1;
  return picked.map((k) => frames[k]);
}

async function encodeFrame(dir, frameIndex, outIndex) {
  const src = framePath(dir, frameIndex);

  const written = [];
  for (const tier of TIERS) {
    const out = await sharp(src)
      // `position: centre` is sharp's default and is stated anyway: it is load-bearing for the
      // portrait crop, and it is what the canvas's own cover-fit does, so the poster and the
      // first drawn frame register to the pixel and the cross-fade has no seam to show.
      .resize(tier.width, tier.height, { fit: "cover", position: "centre", kernel: "lanczos3" })
      .avif({ quality: tier.quality, effort: 4, chromaSubsampling: "4:2:0" })
      .toBuffer();

    const file = `${tier.name}-${String(outIndex).padStart(3, "0")}.${FORMAT}`;
    if (!DRY_RUN) await writeFile(path.join(OUT_DIR, file), out);
    written.push({ tier: tier.name, bytes: out.length });
  }
  return written;
}

/**
 * A generated module rather than a `manifest.json` served from `public/`: it is typed, it is
 * bundled, and it costs no round trip before the first frame can be requested.
 */
async function writeManifest(frameCount, uniqueCount) {
  const body = `// GENERATED by scripts/build-frame-sequence.mjs — do not edit by hand.
//
// Petra, Al-Khazneh through the Siq: a dolly from inside the canyon, opening onto the Treasury,
// closing on the facade. ${frameCount} frames sampled by equal visual change from unique source
// frames ${FROM}..${TO} of ${uniqueCount}, less ${EXCLUDE.map(([a, b]) => `${a}-${b}`).join(",")}.

export const HERO_SEQUENCE = {
  frames: ${frameCount},
  /** Frame 1, full quality, for \`next/image\`. The canvas's first draw is this same frame, so the
   *  hand-off from poster to canvas is a visual no-op. */
  poster: "/scenes/petra/${VERSION}/poster.webp",
  tiers: [
${TIERS.map((t) => `    { id: "${t.name}", w: ${t.width}, h: ${t.height} },`).join("\n")}
  ],
} as const;

export type HeroTierId = (typeof HERO_SEQUENCE.tiers)[number]["id"];

/** 1-based on disk, so callers pass 0-based and this shifts. */
export function heroFrameUrl(tier: HeroTierId, index: number): string {
  return \`/scenes/petra/${VERSION}/\${tier}-\${String(index + 1).padStart(3, "0")}.${FORMAT}\`;
}
`;
  const out = path.join(ROOT, "src/components/blue-hour/heroSequence.ts");
  if (!DRY_RUN) await writeFile(out, body);
  console.log(`manifest  ${path.relative(ROOT, out)}`);
}

async function main() {
  const info = probeVideo(SOURCE);
  const total = info.frames;

  // Pass one: every frame, small, for the selection curve. 320px is enough to measure camera
  // motion and costs seconds rather than the minutes and gigabyte a full-size pass would.
  const analysisDir = path.join(TMP, "analysis");
  extract(SOURCE, analysisDir, "all", 320);
  assertNoDuplicates(analysisDir, total);

  const excluded = (u) => EXCLUDE.some(([a, b]) => u >= a && u <= b);
  const window = Array.from({ length: total }, (_, i) => i).filter(
    (i) => i + 1 >= FROM && i + 1 <= TO && !excluded(i + 1),
  );
  const chosen = await sampleByVisualChange(analysisDir, window, FRAME_COUNT);

  // Pass two: only the survivors, at native resolution.
  const fullDir = path.join(TMP, "full");
  extract(SOURCE, fullDir, chosen);

  console.log(`source        ${path.relative(ROOT, SOURCE)}`);
  console.log(`video         ${info.width}x${info.height} @ ${info.fps}fps, ${total} frames, no duplicates`);
  console.log(`version       ${VERSION}`);
  const dropped = EXCLUDE.reduce((n, [a, b]) => n + (b - a + 1), 0);
  console.log(
    `window        frames ${FROM}..${TO}` +
      (dropped ? `, less ${EXCLUDE.map(([a, b]) => `${a}-${b}`).join(",")} (${dropped} excluded)` : ", nothing excluded") +
      ` = ${window.length} candidates`,
  );
  console.log(`sampling      ${chosen.length} frames by equal visual change`);
  console.log(`tiers         ${TIERS.map((t) => `${t.width}x${t.height} q${t.quality}`).join("  ")} ${FORMAT.toUpperCase()}, no pre-blur`);
  if (DRY_RUN) console.log(`mode          DRY RUN, nothing written`);
  console.log("");

  // Every run replaces the whole sequence. A partial overwrite would leave orphans from a
  // previous, longer run and the client indexes arithmetically — it would happily request a
  // frame from the old sequence and blend two different edits together.
  if (!DRY_RUN) {
    // The whole `petra/` root, not just this version's folder — otherwise every re-cut leaves
    // its predecessor behind and git carries both.
    await rm(OUT_ROOT, { recursive: true, force: true });
    await mkdir(OUT_DIR, { recursive: true });
  }

  const bytes = new Map(TIERS.map((t) => [t.name, 0]));
  let done = 0;

  // Fixed pool rather than a chunked Promise.all: frames vary in complexity, so chunking idles
  // on the slowest frame in each chunk.
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < chosen.length) {
        const i = next++;
        const written = await encodeFrame(fullDir, chosen[i], i + 1);
        for (const w of written) bytes.set(w.tier, bytes.get(w.tier) + w.bytes);
        done++;
        if (done % 20 === 0 || done === chosen.length) {
          process.stdout.write(`  encoded ${done}/${chosen.length}\n`);
        }
      }
    }),
  );

  console.log("");
  let grand = 0;
  for (const tier of TIERS) {
    const b = bytes.get(tier.name);
    grand += b;
    console.log(
      `${tier.width.toString().padStart(5)}px  ${chosen.length} frames  ` +
        `${(b / 1024 / 1024).toFixed(2)} MB  (avg ${Math.round(b / chosen.length / 1024)} KB/frame)`,
    );
  }
  console.log(`total     ${(grand / 1024 / 1024).toFixed(2)} MB`);

  // The poster is the sequence's own first frame at full quality, not the outgoing street
  // photograph. Cross-fading two *different* photographs is a visible dissolve on every load,
  // which reads as a glitch; cross-fading this into a canvas whose first draw is this same frame
  // is a no-op. It goes through `next/image`, so it also gets AVIF and a srcset for free.
  if (!DRY_RUN) {
    await sharp(framePath(fullDir, chosen[0]))
      .resize(1600, 900, { fit: "cover", position: "centre", kernel: "lanczos3" })
      .webp({ quality: 76, effort: 6 })
      .toFile(path.join(OUT_DIR, "poster.webp"));
  }

  await writeManifest(chosen.length, total);

  if (!DRY_RUN) {
    const files = await readdir(OUT_DIR);
    const perTier = TIERS.map((t) => files.filter((f) => f.startsWith(`${t.name}-`) && f.endsWith(FORMAT)).length);
    console.log(`written   ${files.length} files in public/scenes/petra/${VERSION} (${perTier.join(" + ")} + poster)`);
    if (perTier.some((n) => n !== chosen.length)) {
      throw new Error(`expected ${chosen.length} files per tier, got ${perTier.join(" + ")}`);
    }
  }
}

try {
  await main();
} finally {
  // Up to 240 full-size PNGs live here. Removed even on failure — a crashed run should not leave
  // a gigabyte in the system temp dir.
  await rm(TMP, { recursive: true, force: true });
}
