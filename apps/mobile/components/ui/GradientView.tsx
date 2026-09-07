import { Children, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { FASTQUE_BRAND_ICON_DATA_URI } from '@barbercue/shared';

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
 * Legacy landing/Home headers historically built the brand mark as this same gradient with one
 * literal `FQ` Text child. Until every old call-site is migrated to BrandLockup, recognise that
 * exact legacy signature here and render the approved shared FastQue mark instead. CTA/segment
 * gradients are unaffected because they contain different children.
 */
const STOPS = 24;

// 512 x 2 px PNG: #f2295c -> #ff7a3d.
const BRAND_GRADIENT_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAACCAYAAAAuL2TYAAABIklEQVR42u3WZVYDMRQG0G4Hd6fu7l5cirsvu5RSioQT5kyTzOR7G2B+3D1cV2ekxRSjOk3WGQPGVa+yCVNDNQlMEabrejPArFWNdbk5wjywYKqqFglLOhXWXQZWKuwNWZWVhTVgneAu6XkAr6GnKLKej+AHAqaCKkgIAeH80LssQojKckIMiBMSXNYuadfnUjoZ1k8TMkBWlhZyhLzeRyGlVySUZEmhDFQIVS5hV0uwgU5dJ84GDUITaMliwgZhU/iUbUX1tgk7VhHDLrBH2OfCQ1+mA+AQaIewI+BYFhRO9L65U+CMC9idEy6s/IZL4Ipw7Wc/f3yqG+AWuPNi98CDlcfwKDCrJ+CZc9u9qFxOAJwAOAFwAuAEwAmAE4D/F4BftnxWlzC6E3YAAAAASUVORK5CYII=';

// 2 x 512 px PNGs with real per-pixel alpha. These exactly match the two landing/Home hero
// scrims in RoleSelectScreen and HomeScreen and therefore remove the physically observed Android
// row seams without changing the intended colours or opacity ramps.
const SIGNED_OUT_HERO_GRADIENT_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAIACAYAAACo4b0GAAAAPUlEQVR42u3SsRHAIAADsYdLkSKDsP+ENJkC5NKdzh7vt6qa/XmqcWCDAwiIA+iQgIA4gA5pL0AcQMA799ogcgcb4SZNfwAAAABJRU5ErkJggg==';
const AUTH_HOME_HERO_GRADIENT_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAIACAYAAACo4b0GAAAAN0lEQVR42u3LIQ7AIADAwEIml0zz/49i9gEc4iqb3PjeVdXs76nG8cFxHMdxHMdxHMdxHMfv5BvSxAbFZboRXQAAAABJRU5ErkJggg==';

function normalized(color: string): string {
  return color.replace(/\s+/g, '').toLowerCase();
}

function continuousGradientUri(
  colors: readonly [string, string],
  direction: 'horizontal' | 'vertical',
): string | null {
  const start = normalized(colors[0]);
  const end = normalized(colors[1]);

  if (direction === 'horizontal' && start === '#f2295c' && end === '#ff7a3d') {
    return BRAND_GRADIENT_DATA_URI;
  }

  if (direction === 'vertical' && start === 'transparent') {
    if (end === 'rgba(8,12,40,0.96)') return SIGNED_OUT_HERO_GRADIENT_DATA_URI;
    if (end === 'rgba(15,12,25,0.86)') return AUTH_HOME_HERO_GRADIENT_DATA_URI;
  }

  return null;
}

function isLegacyBrandBadge(children: ReactNode): boolean {
  const items = Children.toArray(children);
  if (items.length !== 1) return false;
  const child = items[0];
  return isValidElement<{ children?: ReactNode }>(child) && child.props.children === 'FQ';
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

interface GradientViewProps {
  /** [start, end] as plain "#rrggbb" hex, or "rgba(r,g,b,a)"/"transparent" strings. */
  colors: readonly [string, string];
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

export function GradientView({ colors, direction = 'horizontal', style, children }: GradientViewProps) {
  const continuousUri = continuousGradientUri(colors, direction);
  const useApprovedBrandMark = continuousUri === BRAND_GRADIENT_DATA_URI && isLegacyBrandBadge(children);
  const useAlpha = colors.some((c) => c === 'transparent' || c.startsWith('rgba'));
  let stops: string[];

  if (useAlpha) {
    stops = Array.from({ length: STOPS }, (_, i) => resolveStop(colors[0], colors[1], true, i / (STOPS - 1)));
  } else {
    const [r1, g1, b1] = hexToRgb(colors[0]);
    const [r2, g2, b2] = hexToRgb(colors[1]);
    stops = Array.from({ length: STOPS }, (_, i) => {
      const t = i / (STOPS - 1);
      return `rgb(${lerp(r1, r2, t)}, ${lerp(g1, g2, t)}, ${lerp(b1, b2, t)})`;
    });
  }

  return (
    <View style={[styles.wrap, useApprovedBrandMark && styles.brandMarkWrap, style]}>
      {useApprovedBrandMark ? (
        <Image
          source={{ uri: FASTQUE_BRAND_ICON_DATA_URI }}
          resizeMode="contain"
          style={StyleSheet.absoluteFill}
          accessibilityIgnoresInvertColors
        />
      ) : continuousUri ? (
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
      {!useApprovedBrandMark && children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  brandMarkWrap: { overflow: 'visible' },
  row: { flex: 1, flexDirection: 'row' },
  column: { flex: 1, flexDirection: 'column' },
  stop: { flex: 1 },
});
