import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync("src/components/polar/PolarLanding.css", "utf8");
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `--${name} is not defined in PolarLanding.css`);
  return m[1];
};
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("muted and action-as-text colours reach AA (4.5:1) on both light surfaces", () => {
  for (const fg of ["wd-stone-text", "wd-ember"]) {
    for (const bg of ["wd-paper", "wd-ice"]) {
      const r = ratio(token(fg), token(bg));
      assert.ok(r >= 4.5, `--${fg} on --${bg} is ${r.toFixed(2)}:1`);
    }
  }
});

test("--wd-stone is for rules and fills, never text", () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".css") ? [p] : [];
    });
  const offenders = [];
  for (const file of [...walk("src/components/polar"), ...walk("src/app/offline")]) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/(^|[\s;{])color:\s*var\(--wd-stone\)/.test(line)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("the trip page's labels and footnotes never render under the 11px floor", () => {
  // Inside .tm the em is --wd-base, which bottoms out at 14px: a bare em below 11/14 is under the floor on
  // phones and small laptops. `max(0.6875rem, ...)` keeps the scaling above the floor and guarantees 11px.
  const labels = {
    "src/components/polar/trip/TripBoard.css": [".tb-label", ".tb-day-when", ".tb-leg em", ".tb-budget em", ".tb-total p", ".tb-meta", ".tb-draft", ".tm.trip-board:not(.is-strip) .tb-card-time"],
    "src/components/polar/trip/TripDrawer.css": [".td-eyebrow", ".td-prov", ".td-pill"],
    "src/components/polar/trip/TripSpotlight.css": [".tsl-kicker", ".tsl-hour", ".tsl-gap span", ".tsl-h", ".tsl-foot", ".tsl-tag-kind"],
    "src/components/polar/StoryPlayer.css": [".sp-time", ".sp-now-text .sp-voice", ".sp-chapter-n", ".sp-note"],
  };
  for (const [file, sels] of Object.entries(labels)) for (const sel of sels) {
    const board = readFileSync(file, "utf8");
    const esc = sel.replace(/[.\s():]/g, (c) => (/\s/.test(c) ? "\\s+" : "\\" + c));
    const m = board.match(new RegExp(`(?:^|\\n)[ \\t]*${esc}\\s*\\{[^}]*?font-size:\\s*([^;]+);`));
    assert.ok(m, `${sel} has no font-size`);
    const v = m[1].trim();
    const floor = v.match(/^max\(\s*([\d.]+)rem\b/);
    const px = floor ? parseFloat(floor[1]) * 16 : v.endsWith("rem") ? parseFloat(v) * 16 : v.endsWith("em") ? parseFloat(v) * 14 : v.endsWith("px") ? parseFloat(v) : NaN;
    assert.ok(px >= 11, `${sel} is "${v}": ${px}px at a 14px base`);
  }
});

// Turbopack can load PolarLanding.css twice on one page, the second copy after a screen's own sheet, so a
// screen's `.pp { color: #fff }` lost to `.tm { color: navy }` at equal specificity depending on which
// route loaded first: the planner's dark-photo steps came out navy on night, again and again. `.tm`'s
// base look sits in `:where(.tm)` (zero specificity), so any screen class wins whatever the sheet order.
test(".tm's base colours are zero-specificity, so a screen's own class always overrides them", () => {
  const bare = css.match(/(?:^|\n)\.tm\s*\{([^}]*)\}/);
  assert.ok(bare, "the .tm token block is missing");
  assert.doesNotMatch(bare[1], /(?:^|[;{\s])(color|background):/, ".tm itself sets color or background");
  const base = css.match(/:where\(\.tm\)\s*\{([^}]*)\}/);
  assert.ok(base, "no :where(.tm) base block");
  assert.match(base[1], /\bcolor:\s*var\(--wd-ink\)/);
});

// Meri's cards sit on the hero photograph, which can put near-white behind them (blurred sky or snow
// measured at luminance 0.91), so every text colour in a card is checked against the card's tint over pure white.
test("every text colour in Meri's cards reaches AA (4.5:1) with near-white behind the glass", () => {
  const pill = readFileSync("src/components/polar/MeriPill.css", "utf8");
  const block = (cls) => {
    const m = pill.match(new RegExp(`(?:^|\\n)\\.${cls}\\s*\\{([^}]*)\\}`));
    assert.ok(m, `.${cls} is missing from MeriPill.css`);
    return m[1];
  };
  const tint = pill.match(/\.mp-card,\s*\.mp-fail\.is-on\s*\{[^}]*background:\s*rgba\(9, 11, 16, ([\d.]+)\)/);
  assert.ok(tint, "the card has no rgba(9, 11, 16, a) tint");
  const mix = (fg, a, bg) => fg.map((c, i) => Math.round(a * c + (1 - a) * bg[i]));
  const hex = (rgb) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
  const bg = mix([9, 11, 16], Number(tint[1]), [255, 255, 255]);
  for (const sel of ["mp-kicker", "mp-close", "mp-change", "mp-month", "mp-month-key", "mp-idx", "mp-pdetail", "mp-honest"]) {
    const a = block(sel).match(/(?:^|\n)\s*color:\s*rgba\(255, 255, 255, ([\d.]+)\)/);
    assert.ok(a, `${sel} has no white text colour`);
    const r = ratio(hex(mix([255, 255, 255], Number(a[1]), bg)), hex(bg));
    assert.ok(r >= 4.5, `${sel} (white at ${a[1]}) over the card on white is ${r.toFixed(2)}:1`);
  }
});
