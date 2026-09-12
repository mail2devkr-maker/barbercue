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
  // Owner visual-direction pass (2026-09): these three stops are now the EXACT website gradient
  // colors (apps/web/components/landing/landing.module.css `--fq-pink`/`--fq-coral`/`--fq-orange`
  // on master), not an approximation — see GradientView.tsx for the 3-stop pink->coral->orange
  // rendering this feeds. brandGradientStart/Mid/End are that gradient's three stops; brandCoral is
  // kept as a cheap non-gradient fallback (small dots/dividers where a full GradientView would be
  // overkill) and is now literally the same coral as the gradient's middle stop, not a separate hue.
  brandGradientStart: '#f20a83',
  brandGradientMid: '#ff3e57',
  brandGradientEnd: '#ff7a45',
  brandCoral: '#ff3e57',
  // Website-parity charcoal raised-surface tone (`--fq-utility-bg`), replacing the old purple-navy
  // fill — used for dark accent cards/banners floating on otherwise-light legacy screens.
  brandNavy: '#171314',
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
 * FastQue's native premium surface system.  It intentionally sits beside the legacy BarberCue
 * tokens while screens migrate: the legacy palette is still used by functional flows that have
 * not yet been visually rebuilt, so changing its meaning globally would make a harmless visual
 * pass capable of breaking contrast in those flows.
 *
 * Owner visual-direction pass (2026-09): these values are website-parity, taken directly from
 * `apps/web/components/landing/landing.module.css`'s `--fq-*` custom properties on `master` (the
 * dark header/hero tokens for the current live homepage) — not a "similar" dark theme, the SAME
 * hex/rgba values. The old palette here was purple-tinted (`#090812`/`#11101c`/`#171522`/
 * `#211b2d`) and never matched the website; this replaces it one-for-one so every mobile surface
 * that already reads from `fastQue.*` picks up the website's exact canvas/charcoal/utility/text/
 * brand colors with no per-screen changes. Mapping used:
 *   background        -> --fq-void        #09090c  (page root)
 *   backgroundRaised   -> --fq-charcoal    #0d0d12  (header/nav bars, one step up from void)
 *   card / input       -> --fq-utility-bg  #171314  (cards, search panels, form fields)
 *   cardStrong         -> --fq-utility-bg  #171314  (no separate "extra raised" tone on the
 *                                                     website; emphasis instead comes from
 *                                                     borderStrong, matching the site's own
 *                                                     active/selected treatment)
 *   border             -> --fq-hairline    rgba(255,255,255,0.10)
 *   borderStrong       -> --fq-glass-border rgba(255,62,87,0.28) (coral-tinted emphasis border)
 *   text               -> --fq-text        #f7f5f4
 *   textSecondary      -> --fq-text-muted  rgba(255,255,255,0.72)
 *   textMuted          -> --fq-text-faint  rgba(255,255,255,0.50)
 *   pink/coral/orange  -> --fq-pink/--fq-coral/--fq-orange (exact website gradient stops)
 *   glass/glassStrong  -> void/charcoal-tinted translucency (same alphas as before, recolored off
 *                          the old purple hue onto the website's near-black)
 *
 * success/warning/error are functional status colors with no website equivalent (the landing page
 * has no status UI) and are intentionally left unchanged — this pass is brand/surface parity only.
 */
export const fastQue = {
  background: '#09090c',
  backgroundRaised: '#0d0d12',
  card: '#171314',
  cardStrong: '#171314',
  input: '#171314',
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,62,87,0.28)',
  text: '#f7f5f4',
  textSecondary: 'rgba(255,255,255,0.72)',
  textMuted: 'rgba(255,255,255,0.50)',
  gradientStart: '#f20a83',
  gradientMid: '#ff3e57',
  gradientEnd: '#ff7a45',
  orange: '#ff7a45',
  pink: '#f20a83',
  coral: '#ff3e57',
  success: '#72d59a',
  warning: '#ffc368',
  error: '#ff8b9a',
  glass: 'rgba(9,9,12,0.84)',
  glassStrong: 'rgba(13,13,18,0.94)',
} as const;

export const premiumShadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.34,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 12 },
  elevation: 10,
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
