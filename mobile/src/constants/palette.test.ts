import { Dark, DiscInk, Light, OverPhotograph, composite, contrast, lightness } from './palette';

/**
 * **These numbers are the point of the file, not decoration.**
 *
 * A contrast helper that is quietly wrong blesses every value it is asked about, and the failure
 * is invisible — a palette would ship looking plausible and measuring 3:1. So the first block
 * reproduces the figures on the canvas's "Polar — Token Mapping" sheet, which were computed by a
 * separate implementation from the hex values. A helper that cannot reproduce those cannot be
 * trusted about anything else here.
 */
describe('the helpers', () => {
  it('reproduces the token sheet’s published figures', () => {
    expect(contrast(Dark.accent, Dark.canvas)).toBeCloseTo(7.73, 1);
    expect(contrast(Dark.foreground, Dark.canvas)).toBeCloseTo(19.68, 1);
    expect(contrast(Dark.alert, Dark.canvas)).toBeCloseTo(7.09, 1);
    expect(contrast(Light.foreground, Light.canvas)).toBeCloseTo(14.26, 1);
    expect(contrast(Light.accentText, Light.canvas)).toBeCloseTo(5.74, 1);
    expect(contrast(Light.accentForeground, Light.accent)).toBeCloseTo(5.6, 1);
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

describe('both appearances', () => {
  it.each([
    ['night', Dark],
    ['light', Light],
  ] as const)('%s carries every text role at AA on its canvas and its paper', (_name, palette) => {
    for (const ground of [palette.canvas, palette.surfaceDeep]) {
      for (const role of ['foreground', 'muted', 'accentText', 'money', 'alert'] as const) {
        expect(contrast(palette[role], ground)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(palette.accentForeground, palette.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps action a fill on light, which is why accentText exists', () => {
    // The negative control for the one role that splits. Signal is the action fill in both
    // appearances and reads as text on night; on ice it measures 2.55:1. If this ever passes,
    // the light fill has been darkened and `accentText` is doing nothing.
    expect(contrast(Light.accent, Light.canvas)).toBeLessThan(3);
    expect(Dark.accentText).toBe(Dark.accent);
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
  it('keeps the emphasised disc readable', () => {
    // The disc carries a stop number in `DiscInk` on the action fill. Kiln split this token out
    // because its light accent darkened to 2.49:1 under that ink; Polar's fill is the same in both
    // appearances, so the token and the fill agree — and the number still has to clear AA.
    const ink = (fill: string) => composite(DiscInk.slice(0, 7), 0xeb / 255, fill);
    expect(contrast(ink(OverPhotograph.accentDisc), OverPhotograph.accentDisc)).toBeGreaterThanOrEqual(4.5);
    expect(OverPhotograph.accentDisc).toBe(Dark.accent);
    expect(OverPhotograph.accentDisc).toBe(Light.accent);
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
  it('keeps the ladder in the same order in both appearances', () => {
    // Kiln mirrored dark's perceptual steps into light. Polar does not — paper is meant to be a
    // visible step from ice, as it is on the reference — but the order has to hold, or a pressed
    // control could read as quieter than a resting one.
    const step = (palette: typeof Dark, surface: string) =>
      Math.abs(lightness(palette.canvas) - lightness(flatten(surface, palette.canvas)));

    for (const palette of [Dark, Light]) {
      const steps = (['control', 'panel', 'bar', 'pressed', 'surfaceDeep'] as const).map((k) => step(palette, palette[k]));
      for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    }
  });

  it('keeps every surface one slate per appearance, never a sampled grey', () => {
    // Polar's deep on night and Polar's ink as a veil on light.
    for (const [palette, slate] of [
      [Dark, '#0E1118'],
      [Light, '#1F2A44'],
    ] as const) {
      for (const key of ['panel', 'control', 'bar', 'pressed'] as const) {
        expect(palette[key].slice(0, 7).toUpperCase()).toBe(slate);
      }
    }
  });

  /**
   * The disabled primary. `PrimaryButton` used to dim the whole control with `opacity: 0.4`,
   * which fades the fill and the label together — the negative control below is what that
   * measured. The pairing it uses now is a surface and an ink, so it can be checked.
   */
  it('shows a disabled primary whose label can still be read', () => {
    for (const palette of [Dark, Light]) {
      const surface = flatten(palette.panel, palette.canvas);
      const ink = flatten(palette.muted, surface);
      expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('records why dimming the whole control was abandoned', () => {
    for (const palette of [Dark, Light]) {
      const fill = composite(palette.accent, 0.4, palette.canvas);
      const label = composite(palette.accentForeground, 0.4, palette.canvas);
      // Both appearances land near 2:1 — the label all but disappears into its own button.
      expect(contrast(label, fill)).toBeLessThan(2.5);
    }
  });
});

/** A surface may be `#RRGGBB` or `#RRGGBBAA`; resolve it against its ground either way. */
function flatten(surface: string, ground: string): string {
  if (surface.length === 7) return surface;
  return composite(surface.slice(0, 7), parseInt(surface.slice(7, 9), 16) / 255, ground);
}
