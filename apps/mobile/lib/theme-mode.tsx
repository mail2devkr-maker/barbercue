import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { color as designedLight, fastQue as designedDark } from './theme';
import { getItem, setItem } from './secure-storage';

/**
 * Owner request (Light / Dark theme). The app has two designed palettes today:
 *   `color`   - light cream, used by the owner/staff screens and older flows;
 *   `fastQue` - dark, used by the customer screens and the premium surfaces.
 * Each gets a TWIN in the other theme with the SAME keys, so a screen keeps its style code and
 * only reads its tokens from useThemeTokens() instead of the module constants.
 *
 *   'designed' (default) - every screen exactly as designed today (no visual change at all)
 *   'light' / 'dark'     - every converted screen uses that theme
 *   'system'             - follows the phone's light/dark setting
 */
export type ThemeChoice = 'designed' | 'light' | 'dark' | 'system';
export type ResolvedTheme = 'designed' | 'light' | 'dark';

export type LightTokens = { readonly [K in keyof typeof designedLight]: string };
export type DarkTokens = { readonly [K in keyof typeof designedDark]: string };

/** Dark twin of the light `color` palette (same keys). */
export const colorOnDark: LightTokens = {
  ink: '#f7f5f4',
  muted: 'rgba(255,255,255,0.64)',
  border: 'rgba(255,255,255,0.12)',
  surface: '#09090c',
  surfaceTint: '#171314',
  success: '#72d59a',
  successSoft: 'rgba(114,213,154,0.12)',
  warn: '#ffc368',
  accent: '#ff3e57',
  accentSoft: 'rgba(255,62,87,0.14)',
  // White on this coral is only 3.45:1; near-black reads 5.9:1 (same as the web dark theme's button ink).
  accentContrast: '#09090c',
  gold: '#e0b25a',
  goldSoft: 'rgba(224,178,90,0.14)',
  brandGradientStart: designedLight.brandGradientStart,
  brandGradientMid: designedLight.brandGradientMid,
  brandGradientEnd: designedLight.brandGradientEnd,
  brandCoral: designedLight.brandCoral,
  brandNavy: '#211b1c',
};

/** Light twin of the dark `fastQue` palette (same keys). */
export const fastQueOnLight: DarkTokens = {
  background: '#fffdf9',
  backgroundRaised: '#f8f1e6',
  card: '#ffffff',
  cardStrong: '#ffffff',
  input: '#ffffff',
  border: 'rgba(28,26,23,0.12)',
  borderStrong: 'rgba(176,65,62,0.30)',
  text: '#1c1a17',
  textSecondary: 'rgba(28,26,23,0.74)',
  textMuted: 'rgba(28,26,23,0.66)',
  gradientStart: designedDark.gradientStart,
  gradientMid: designedDark.gradientMid,
  gradientEnd: designedDark.gradientEnd,
  orange: '#b8461a',
  pink: '#d1086f',
  coral: '#e0304a',
  success: '#2e7d32',
  warning: '#b36b00',
  error: '#b0413e',
  glass: 'rgba(255,253,249,0.90)',
  glassStrong: 'rgba(255,253,249,0.96)',
};

/**
 * Text and icons drawn ON a photo, the brand gradient or a coloured pill/button. The designs used the
 * cream background colour (`color.surface`) for this; it must stay light in every theme, so it is a
 * constant (exactly the designed cream).
 */
export const ON_ACCENT = '#fffdf9';

/** Surfaces that were hard-coded hex values in components (e.g. Card's white). */
export interface SurfaceTokens {
  /** A card on a light-designed screen (#ffffff by design). */
  card: string;
  /** Text on a card/notice that must stay readable on that card. */
  onCard: string;
  /** Status bar content: 'light' text on dark backgrounds, 'dark' on light. */
  statusBarOn: 'light' | 'dark';
  /** Error text on an error-tinted card. */
  errorText: string;
  /** Text on a selected pill/tab painted with the ink colour (inverts with the theme). */
  inverseText: string;
  /** Always-dark backdrop (photo viewer, image placeholder). */
  photoBackdrop: string;
}

export interface ThemeTokens {
  /** The light-family palette for this screen (`color` keys). */
  color: LightTokens;
  /** The dark-family palette for this screen (`fastQue` keys). */
  fastQue: DarkTokens;
  surface: SurfaceTokens;
  /** The theme in force: 'designed' means exactly today's look. */
  resolved: ResolvedTheme;
}

const DESIGNED: ThemeTokens = {
  color: designedLight,
  fastQue: designedDark,
  surface: { card: '#ffffff', onCard: designedLight.ink, statusBarOn: 'dark', errorText: '#8f302d', inverseText: '#ffffff', photoBackdrop: '#1c1a17' },
  resolved: 'designed',
};
/** Light theme: the designed `color` palette, with the brand coral deepened where it is read as text. */
export const colorOnLight: LightTokens = { ...designedLight, brandCoral: '#d4183a' };

const LIGHT: ThemeTokens = {
  color: colorOnLight,
  fastQue: fastQueOnLight,
  surface: { card: '#ffffff', onCard: designedLight.ink, statusBarOn: 'dark', errorText: '#8f302d', inverseText: '#ffffff', photoBackdrop: '#1c1a17' },
  resolved: 'light',
};
const DARK: ThemeTokens = {
  color: colorOnDark,
  fastQue: designedDark,
  surface: { card: '#171314', onCard: colorOnDark.ink, statusBarOn: 'light', errorText: '#ff8b9a', inverseText: '#09090c', photoBackdrop: '#1c1a17' },
  resolved: 'dark',
};

export function tokensFor(resolved: ResolvedTheme): ThemeTokens {
  return resolved === 'light' ? LIGHT : resolved === 'dark' ? DARK : DESIGNED;
}

export function resolveTheme(choice: ThemeChoice, system: string | null | undefined): ResolvedTheme {
  if (choice === 'system') return system === 'dark' ? 'dark' : 'light';
  return choice;
}

const STORAGE_KEY = 'theme_choice_v1';
const CHOICES: readonly ThemeChoice[] = ['designed', 'light', 'dark', 'system'];

interface ThemeContextValue {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
  tokens: ThemeTokens;
}

const ThemeContext = createContext<ThemeContextValue>({
  choice: 'designed',
  setChoice: () => undefined,
  tokens: DESIGNED,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [choice, setChoiceState] = useState<ThemeChoice>('designed');

  useEffect(() => {
    let alive = true;
    getItem(STORAGE_KEY)
      .then((saved) => {
        if (alive && saved && (CHOICES as readonly string[]).includes(saved)) setChoiceState(saved as ThemeChoice);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    void setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ choice, setChoice, tokens: tokensFor(resolveTheme(choice, system)) }),
    [choice, setChoice, system],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The colour tokens for the theme in force. Outside a ThemeProvider: exactly today's design. */
export function useThemeTokens(): ThemeTokens {
  return useContext(ThemeContext).tokens;
}

export function useThemeChoice(): Pick<ThemeContextValue, 'choice' | 'setChoice'> {
  const { choice, setChoice } = useContext(ThemeContext);
  return { choice, setChoice };
}

/**
 * Styles that follow the theme. Write the stylesheet as a function of the tokens - parameter names
 * `color` and `fastQue` shadow the module constants, so the style body itself does not change:
 *
 *   const makeStyles = ({ color, fastQue }: ThemeTokens) => StyleSheet.create({ ... });
 *   const styles = useThemedStyles(makeStyles);
 *
 * Built once per theme and cached, so re-renders never rebuild stylesheets.
 */
const styleCache = new WeakMap<(tokens: ThemeTokens) => unknown, Map<ResolvedTheme, unknown>>();

export function themedStyles<T>(factory: (tokens: ThemeTokens) => T, tokens: ThemeTokens): T {
  let perTheme = styleCache.get(factory);
  if (!perTheme) {
    perTheme = new Map();
    styleCache.set(factory, perTheme);
  }
  if (!perTheme.has(tokens.resolved)) perTheme.set(tokens.resolved, factory(tokens));
  return perTheme.get(tokens.resolved) as T;
}

export function useThemedStyles<T>(factory: (tokens: ThemeTokens) => T): T {
  return themedStyles(factory, useThemeTokens());
}

/**
 * Status bar text colour: "As designed" keeps each screen's own choice (`designed`); Light uses dark
 * text and Dark uses light text everywhere, so the clock/battery stay readable.
 */
export function statusBarStyleFor(resolved: ResolvedTheme, designed: 'light' | 'dark'): 'light' | 'dark' {
  if (resolved === 'designed') return designed;
  return resolved === 'dark' ? 'light' : 'dark';
}

export function useStatusBarStyle(designed: 'light' | 'dark'): 'light' | 'dark' {
  return statusBarStyleFor(useThemeTokens().resolved, designed);
}
