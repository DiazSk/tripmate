/**
 * Polar Interior — the token system on the MagicPath board ("White Desert — Design Tokens"),
 * read off white-desert.com and translated for React Native: em → points at a 15pt base,
 * CSS variables → constants, font stacks → the families `@expo-google-fonts` registers.
 *
 * **Its own module, deliberately not `constants/theme.ts`.** Kiln is the app's system and this is
 * a separate direction being tried on one screen (`app/polar-landing.tsx`). Mixing the two would
 * leave half the app reading tokens it was never designed against.
 */
export const Polar = {
  ice: '#FFFFFF',
  snow: '#F5F5F5',
  paper: '#F3F1EC',
  beige: '#DCD8CC',
  ink: '#1F2A44',
  charcoal: '#535353',
  stone: '#A4A29C',
  deep: '#0E1118',
  night: '#090B10',
  nightText2: '#A8ACB3',
  signal: '#FF7E15',
  signalPressed: '#E86F0C',
  ember: '#B4530A',
  route: '#6AF0FF',
  alertText: '#D10F0F',
  veil05: 'rgba(31,42,68,0.05)',
  veil20: 'rgba(31,42,68,0.20)',
  frost10: 'rgba(255,255,255,0.10)',
  frost20: 'rgba(255,255,255,0.20)',
  rule: 'rgba(31,42,68,0.12)',
} as const;

/** Loaded by the route itself — see `app/polar-landing.tsx`. */
export const PolarFonts = {
  display: 'CormorantGaramond_400Regular',
  displayItalic: 'CormorantGaramond_500Medium_Italic',
  sans: 'InterTight_500Medium',
  sansRegular: 'InterTight_400Regular',
  sansSemi: 'InterTight_600SemiBold',
  condensed: 'Oswald_400Regular',
} as const;

/** The reference's em ladder (0.35 → 7em) at 15pt. */
export const PolarSpace = { s1: 5, s2: 11, s3: 16, s4: 22, s5: 30, s6: 41, s8: 60, s10: 82, s12: 105, gutter: 11, pad: 19 } as const;

/** Nearly square. Depth comes from blur over photography, not from rounding. */
export const PolarRadius = { hairline: 2, sm: 4, card: 6, md: 8 } as const;

export const PolarMotion = {
  /** How long a stop is held once the camera has arrived. Apple Maps ignores `animateCamera`'s
   *  duration on this architecture (see `day-map.tsx`), so the hold is the only clock we own. */
  hold: 3600,
  phase: 900,
} as const;

export const PolarType = {
  monument: { fontFamily: PolarFonts.condensed, textTransform: 'uppercase' as const, letterSpacing: -0.5 },
  display: { fontFamily: PolarFonts.display, fontSize: 38, lineHeight: 38, textTransform: 'uppercase' as const },
  lead: { fontFamily: PolarFonts.displayItalic, fontSize: 21, lineHeight: 25 },
  kicker: { fontFamily: PolarFonts.displayItalic, fontSize: 17, lineHeight: 20 },
  body: { fontFamily: PolarFonts.sans, fontSize: 15, lineHeight: 22 },
  bodyS: { fontFamily: PolarFonts.sans, fontSize: 13, lineHeight: 19 },
  ui: { fontFamily: PolarFonts.sansSemi, fontSize: 14, lineHeight: 17 },
  eyebrow: { fontFamily: PolarFonts.sansSemi, fontSize: 12, lineHeight: 16, letterSpacing: 2.1, textTransform: 'uppercase' as const },
  caption: { fontFamily: PolarFonts.sans, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: PolarFonts.condensed, fontSize: 12, lineHeight: 15, letterSpacing: 0.8, textTransform: 'uppercase' as const },
  coord: { fontFamily: PolarFonts.sans, fontSize: 11, letterSpacing: 0.7 },
  stat: { fontFamily: PolarFonts.sansRegular, fontSize: 22, lineHeight: 27, textTransform: 'uppercase' as const },
} as const;
