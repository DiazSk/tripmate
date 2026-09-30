import { Dark, DiscInk, Light, OverPhotograph, composite, contrast, lightness } from './palette';

/**
 * **These numbers are the point of the file, not decoration.**
 *
 * A contrast helper that is quietly wrong blesses every value it is asked about, and the failure
 * is invisible — a light palette would ship looking plausible and measuring 3:1. So the first
 * block reproduces the *dark* appearance's published figures from `DESIGN.md`, which were
 * measured independently and long before any of this. A helper that cannot reproduce those
 * cannot be trusted about the light ones.
 */
describe('the helpers', () => {
  it('reproduces the dark appearance’s published figures', () => {
    expect(contrast(Dark.accent, Dark.canvas)).toBeCloseTo(7.5, 1);
    expect(contrast(Dark.money, Dark.canvas)).toBeCloseTo(9.97, 1);
    expect(contrast(Dark.alert, Dark.canvas)).toBeCloseTo(5.09, 1);
    expect(contrast(Dark.foreground, Dark.canvas)).toBeCloseTo(17.33, 1);
  });

  it('fails the pair it is supposed to fail', () => {
    // The negative control. Dark's own jade on paper is the exact reason the light appearance
    // needs darkened cuts at all — if this ever reads as passing, the helper is broken, not the
    // colour.
    expect(contrast('#28B981', '#F7F5F2')).toBeLessThan(2.5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('composites an alpha the way the compositor does', () => {
    expect(composite('#000000', 1, '#FFFFFF')).toBe('#000000');
    expect(composite('#000000', 0, '#FFFFFF')).toBe('#FFFFFF');
    expect(composite('#FFFFFF', 0.5, '#000000')).toBe('#808080');
  });
});

describe('the light appearance', () => {
  it('carries every role at AA on its own ground', () => {
    expect(contrast(Light.foreground, Light.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(Light.accent, Light.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(Light.money, Light.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(Light.alert, Light.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(Light.accentForeground, Light.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('inverts to exactly the ink/paper ratio dark ships', () => {
    // Not a coincidence worth hiding: the two appearances are the same two colours swapped, so
    // the figure has to be identical. If it drifts, somebody sampled a new grey.
    expect(contrast(Light.foreground, Light.canvas)).toBeCloseTo(
      contrast(Dark.foreground, Dark.canvas),
      5,
    );
  });
});

/**
 * **A role's own ink never goes on that role's own soft tint.**
 *
 * This is an existing unwritten rule, and the dark appearance already breaks it: coral on
 * `alertSoft` is 4.28 today. Writing it down fixes both appearances and costs no new colour —
 * the tint carries the signal and `foreground` carries the words.
 */
describe('the soft tints', () => {
  const tints = [
    ['accentWash', Dark, Dark.accent, Dark.accentWash],
    ['moneySoft', Dark, Dark.money, Dark.moneySoft],
    ['alertSoft', Dark, Dark.alert, Dark.alertSoft],
    ['accentWash', Light, Light.accent, Light.accentWash],
    ['moneySoft', Light, Light.money, Light.moneySoft],
    ['alertSoft', Light, Light.alert, Light.alertSoft],
  ] as const;

  it.each(tints)('%s: foreground clears AA on it', (_name, palette, _role, tint) => {
    expect(contrast(palette.foreground, flatten(tint, palette.canvas))).toBeGreaterThanOrEqual(4.5);
  });

  it('is why the rule exists: at least one role would fail on its own tint', () => {
    const failing = tints.filter(
      ([, palette, role, tint]) => contrast(role, flatten(tint, palette.canvas)) < 4.5,
    );
    expect(failing.length).toBeGreaterThan(0);
  });

  /**
   * The tint ceiling, restated. DESIGN.md carried it as a `29` hex, which is a proxy for a
   * perceptual step and does not survive a change of ground — the same alpha over paper is a
   * much larger step than over near-black. 8.3 is what `alertSoft` ships at in dark.
   *
   * `moneySoft` is not in this list, and finding out why is what this assertion is for:
   * DESIGN.md:417 exempts it by name — "a fill, not a state tint, so this clause never governed
   * it". Two signals are licensed as *state*; a fill is neither.
   */
  it.each(tints.filter(([name]) => name !== 'moneySoft'))(
    '%s: stays under the perceptual ceiling',
    (_name, palette, _role, tint) => {
      const step = Math.abs(lightness(palette.canvas) - lightness(flatten(tint, palette.canvas)));
      expect(step).toBeLessThanOrEqual(8.3);
    },
  );

  /**
   * The exemption is load-bearing in dark and slack in light, and that asymmetry is worth
   * pinning rather than smoothing over: dark's `moneySoft` is nearly twice the ceiling, while
   * light's lands under it by accident of the ground. So the clause is not a formality DESIGN.md
   * could drop — remove it and the dark appearance fails its own rule.
   */
  it('is over the ceiling in dark, which is why the exemption is not a formality', () => {
    const step = (p: typeof Dark) =>
      Math.abs(lightness(p.canvas) - lightness(flatten(p.moneySoft, p.canvas)));
    expect(step(Dark)).toBeGreaterThan(8.3);
    expect(step(Light)).toBeLessThanOrEqual(8.3);
  });
});

/**
 * The basemap follows the appearance; the day cores and the disc ink do not. That split is the
 * whole reason one token survives here.
 */
describe('over the map', () => {
  it('keeps the emphasised disc readable, which the action colour would not', () => {
    // The regression this group exists to stop, stated as the two numbers. Light's `accent` is
    // correct as an ink on paper and wrong as a fill under `DiscInk`; both facts are true at
    // once, which is why the disc needed its own token rather than a different jade.
    const ink = (fill: string) => composite(DiscInk.slice(0, 7), 0xeb / 255, fill);
    expect(contrast(ink(OverPhotograph.accentDisc), OverPhotograph.accentDisc)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink(Light.accent), Light.accent)).toBeLessThan(3);
  });

  it('keeps one ink over a photograph in both appearances', () => {
    // The photograph is dark whatever the page is, so this token is the one that must not move.
    for (const palette of [Dark, Light]) {
      expect(palette.onDeep).toBe(Dark.foreground);
      expect(contrast(palette.onDeep, Dark.canvas)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the surface ladder', () => {
  it('mirrors dark’s perceptual steps rather than its alphas', () => {
    // Mirroring the alpha instead would collapse the ramp to nothing near white: 62% slate over
    // paper is a dark grey card, not a surface one step in.
    const step = (palette: typeof Dark, surface: string) =>
      Math.abs(lightness(palette.canvas) - lightness(flatten(surface, palette.canvas)));

    for (const key of ['control', 'panel', 'bar', 'pressed', 'surfaceDeep'] as const) {
      expect(step(Light, Light[key])).toBeCloseTo(step(Dark, Dark[key]), 0);
    }
  });

  it('keeps every surface one slate, never a sampled grey', () => {
    for (const palette of [Dark, Light]) {
      for (const key of ['panel', 'control', 'bar', 'pressed'] as const) {
        expect(palette[key].slice(0, 7).toUpperCase()).toBe('#1C1A18');
      }
    }
  });
});

/** A surface may be `#RRGGBB` or `#RRGGBBAA`; resolve it against its ground either way. */
function flatten(surface: string, ground: string): string {
  if (surface.length === 7) return surface;
  return composite(surface.slice(0, 7), parseInt(surface.slice(7, 9), 16) / 255, ground);
}
