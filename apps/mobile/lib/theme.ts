/**
 * BarberCue brand tokens, ported from apps/web/app/globals.css's `--bc-*` custom properties (the
 * single source of truth for this design system). Kept as plain constants rather than a second
 * CSS-variable-style system — React Native has no native equivalent to reach for instead.
 *
 * Gold is decorative only (eyebrows, accents, notice tints) — never an action color. Terracotta
 * (`accent`) is the only primary-action color, matching web's own convention.
 */
export const color = {
  ink: '#1c1a17',
  muted: '#6b6357',
  border: '#e7e0d3',
  surface: '#fffdf9',
  surfaceTint: '#f8f1e6',
  success: '#2e7d32',
  successSoft: 'rgba(46, 125, 50, 0.08)',
  warn: '#b36b00',
  accent: '#b0413e',
  accentSoft: 'rgba(176, 65, 62, 0.08)',
  accentContrast: '#ffffff',
  gold: '#a8791f',
  goldSoft: '#f7ecd3',
  // FastQue Home redesign — distinct brand accents for the new hero/search-panel/CTA surfaces,
  // additive to the palette above rather than replacing it: `accent` (terracotta) remains the one
  // action color everywhere else in the app.
  //
  // The reference design's pink->orange gradient is rendered as a REAL two-stop gradient (see
  // components/ui/GradientView.tsx) via a row of interpolated solid-color strips, not an image or
  // native gradient library — neither react-native-svg nor expo-linear-gradient is installed, and
  // either would be a new NATIVE dependency that forces a rebuild before the next OTA (this
  // codebase already made the identical call for RoleSelectScreen's hero scrim). brandGradientStart
  // /End are that gradient's two stops; brandCoral is kept as a cheap non-gradient fallback (small
  // dots/dividers where a full GradientView would be overkill).
  brandGradientStart: '#f2295c',
  brandGradientEnd: '#ff7a3d',
  brandCoral: '#f2542d',
  brandNavy: '#1a1533',
} as const;

/** Matches web's 1.25-ratio type scale (`--bc-text-*`). */
export const fontSize = {
  xs: 13,
  sm: 14.4,
  base: 16,
  lg: 20,
  xl: 25.6,
  '2xl': 32,
} as const;

/** Matches web's 4px spacing scale (`--bc-space-*`). */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 48,
  8: 64,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

/**
 * Font family names as registered with expo-font's useFonts() in App.tsx — must match those keys
 * exactly. Fraunces is the display face (headings/wordmark); Work Sans is body/UI, mirroring
 * web's --font-display / --font-body.
 */
export const font = {
  displayMedium: 'Fraunces_500Medium',
  displaySemiBold: 'Fraunces_600SemiBold',
  bodyRegular: 'WorkSans_400Regular',
  bodyMedium: 'WorkSans_500Medium',
  bodySemiBold: 'WorkSans_600SemiBold',
  bodyBold: 'WorkSans_700Bold',
} as const;

/**
 * Physical-device Build 10 retest: Hindi text in chips/badges/pills was visibly clipped vertically
 * (matras cut off top/bottom) on Android. Root cause — Fraunces/Work Sans are Latin-only webfonts
 * with no Devanagari glyphs, so Android silently substitutes a system Devanagari font per-glyph at
 * *render* time, but React Native's Yoga layout measures line height from the *requested* font
 * (the Latin one) at *layout* time. The substituted fallback font's taller glyph metrics then
 * overflow a box sized for the smaller Latin metrics. An explicit, generous lineHeight sidesteps
 * the mismeasurement entirely by not relying on font-metric auto-sizing at all. Use this for any
 * Text style that can render translated (potentially Hindi) content — proper nouns/IDs that are
 * always Latin don't need it, but nothing is hurt by using it there too.
 */
export function lineHeightFor(size: number): number {
  return Math.round(size * 1.55);
}
