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
