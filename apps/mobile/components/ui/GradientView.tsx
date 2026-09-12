import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * A real two-stop linear gradient with zero new dependencies.
 *
 * Android rendered the former row/column of adjacent solid-color Views with fractional pixel
 * rounding gaps. That showed up physically as vertical seams in FastQue's horizontal brand
 * gradients and horizontal "grid" lines across the hero's vertical alpha scrim.
 *
 * For the gradients FastQue actually ships on the landing/Home screens, use one continuous raster
 * surface instead. This stays OTA-safe (no native dependency or rebuild) and preserves alpha for
 * the hero scrims. The strip fallback remains only for uncommon gradients that do not match these
 * production tokens.
 *
 */
const STOPS = 24;

// 512 x 2 px PNG, website-parity 3-stop brand gradient: --fq-pink #f20a83 (0%) -> --fq-coral
// #ff3e57 (55%) -> --fq-orange #ff7a45 (100%) — the exact stops/positions from
// apps/web/components/landing/landing.module.css's `--fq-gradient` on master, regenerated from
// the old (non-website) two-stop #f2295c->#ff7a3d PNG during the owner visual-direction pass.
const BRAND_GRADIENT_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAACCAIAAAChTfOPAAAAnElEQVR4nO1SMRKAMAgDR7/tj/2ADrYKGOjROyfJBLEmDYX3daMLTERHqwXDqhVnng+dNExvhQLQ1y1kiKG+ZVx9HQHoo1BKn6H+MFH/s90/42j0wxmGY4xmqJ4J6yfWwFkMuwYjRz8RQ33f0eiP1sBfDBXhpW8YW6OxgFoHwYdjo7uecvRq+TrTMVOOXswa7AeDXQRRKBQKBfoPTrJ0P8KAtul1AAAAAElFTkSuQmCC';

// 2 x 512 px PNGs with real per-pixel alpha. These exactly match the two hero scrims in
// RoleSelectScreen and HomeScreen and therefore remove the physically observed Android row seams
// without changing the intended alpha ramps. Recolored during the owner visual-direction pass
// from purple-navy tints to website-parity void/charcoal (`--fq-void`/`--fq-charcoal`), matching
// the dark scrim treatment apps/web/components/landing/HeroVisual.tsx uses behind its own hero
// photograph.
const SIGNED_OUT_HERO_GRADIENT_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAIACAYAAACo4b0GAAAAV0lEQVR4nO3SMQrAQAwDwT2j5iD/f29I/hAQl3XhwpWEZ+198cy8GwiwDrxMR4xYhz/+6/iC0xEjFsQPFrGJIBFkEZsIEkEWsYkgEWQRmwgSQRax+e5yAwStBv2KjPT1AAAAAElFTkSuQmCC';
const AUTH_HOME_HERO_GRADIENT_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAIACAYAAACo4b0GAAAAWklEQVR4nO3UIQ7AMAwEwY11NKT/f2yVyrCgptUeCIhkYs157X1xUs8LBFjjn3IcVyebTqwMnot3CTVBEsdxdbLpxMrgufgqoWSDlRlLKNkgG9l0YmX47bm4AULZBr22TXyVAAAAAElFTkSuQmCC';

function normalized(color: string): string {
  return color.replace(/\s+/g, '').toLowerCase();
}

function continuousGradientUri(
  colors: readonly string[],
  direction: 'horizontal' | 'vertical',
): string | null {
  const norm = colors.map(normalized);

  if (direction === 'horizontal' && norm.length === 3 && norm[0] === '#f20a83' && norm[1] === '#ff3e57' && norm[2] === '#ff7a45') {
    return BRAND_GRADIENT_DATA_URI;
  }

  if (direction === 'vertical' && norm.length === 2 && norm[0] === 'transparent') {
    if (norm[1] === 'rgba(9,9,12,0.96)') return SIGNED_OUT_HERO_GRADIENT_DATA_URI;
    if (norm[1] === 'rgba(13,13,18,0.86)') return AUTH_HOME_HERO_GRADIENT_DATA_URI;
  }

  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

interface GradientViewProps {
  /** 2 or 3 stops, as plain "#rrggbb" hex, or "rgba(r,g,b,a)"/"transparent" strings — 3 stops for
   * the website's exact pink->coral->orange brand gradient (see `stops` below). */
  colors: readonly [string, string] | readonly [string, string, string];
  /** Stop positions (0-1) matching `colors`, e.g. the website's pink 0% / coral 55% / orange 100%
   * (`--fq-gradient`'s own stop percentages). Defaults to evenly spaced. */
  stops?: readonly number[];
  /** 'horizontal' (default, left->right) or 'vertical' (top->bottom). */
  direction?: 'horizontal' | 'vertical';
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

function resolveStop(color: string, other: string, useAlpha: boolean, t: number): string {
  if (useAlpha) {
    const startAlpha = color === 'transparent' ? 0 : Number(color.match(/[\d.]+(?=\s*\))/)?.[0] ?? 1);
    const endAlpha = other === 'transparent' ? 0 : Number(other.match(/[\d.]+(?=\s*\))/)?.[0] ?? 1);
    const rgbSource = color !== 'transparent' ? color : other;
    const rgbMatch = rgbSource.match(/\d+(?:\.\d+)?/g) ?? ['0', '0', '0'];
    const [r, g, b] = rgbMatch;
    const alpha = startAlpha + (endAlpha - startAlpha) * t;
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }
  return color;
}

/** Interpolates across an arbitrary number of stops (2 for a simple gradient, 3 for the brand
 * pink->coral->orange), picking the segment `t` falls into and lerping within it. */
function colorAt(colors: readonly string[], positions: readonly number[], useAlpha: boolean, t: number): string {
  let i = 0;
  while (i < positions.length - 2 && t > positions[i + 1]) i++;
  const span = positions[i + 1] - positions[i];
  const localT = span === 0 ? 0 : (t - positions[i]) / span;

  if (useAlpha) {
    return resolveStop(colors[i], colors[i + 1], true, localT);
  }
  const [r1, g1, b1] = hexToRgb(colors[i]);
  const [r2, g2, b2] = hexToRgb(colors[i + 1]);
  return `rgb(${lerp(r1, r2, localT)}, ${lerp(g1, g2, localT)}, ${lerp(b1, b2, localT)})`;
}

export function GradientView({ colors, stops: stopPositions, direction = 'horizontal', style, children }: GradientViewProps) {
  const continuousUri = continuousGradientUri(colors, direction);
  const useAlpha = colors.some((c) => c === 'transparent' || c.startsWith('rgba'));
  const positions = stopPositions ?? colors.map((_, i) => i / (colors.length - 1));
  const stops = Array.from({ length: STOPS }, (_, i) => colorAt(colors, positions, useAlpha, i / (STOPS - 1)));

  return (
    <View style={[styles.wrap, style]}>
      {continuousUri ? (
        <Image source={{ uri: continuousUri }} resizeMode="stretch" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={direction === 'horizontal' ? styles.row : styles.column}>
            {stops.map((backgroundColor, i) => (
              <View key={i} style={[styles.stop, { backgroundColor }]} />
            ))}
          </View>
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  row: { flex: 1, flexDirection: 'row' },
  column: { flex: 1, flexDirection: 'column' },
  stop: { flex: 1 },
});
