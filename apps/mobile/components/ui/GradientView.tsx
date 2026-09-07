import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * A real two-stop linear gradient with zero new dependencies. Android rendered the former row of
 * adjacent solid-color Views with fractional-width rounding gaps, visible as vertical seams in
 * the FastQue segmented selector and primary CTA. The standard brand gradient is therefore a
 * single 512-pixel raster layer, stretched by the native image renderer: one continuous surface,
 * no independently-rounded child edges, and no native dependency/build change. The vertical,
 * alpha-only hero scrim keeps its strips because it is not affected by horizontal rounding and
 * its transparent/dark inputs cannot use the opaque brand bitmap.
 */
const STOPS = 24;

// 512 × 2 px PNG: #f2295c → #ff7a3d. It is deliberately embedded rather than added as a binary
// asset so this UI-only correction can ship through the existing compatible OTA. Keep this in sync
// with the two standard FastQue brand stops in lib/theme.ts.
const BRAND_GRADIENT_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAACCAYAAAAuL2TYAAABIklEQVR42u3WZVYDMRQG0G4Hd6fu7l5cirsvu5RSioQT5kyTzOR7G2B+3D1cV2ekxRSjOk3WGQPGVa+yCVNDNQlMEabrejPArFWNdbk5wjywYKqqFglLOhXWXQZWKuwNWZWVhTVgneAu6XkAr6GnKLKej+AHAqaCKkgIAeH80LssQojKckIMiBMSXNYuadfnUjoZ1k8TMkBWlhZyhLzeRyGlVySUZEmhDFQIVS5hV0uwgU5dJ84GDUITaMliwgZhU/iUbUX1tgk7VhHDLrBH2OfCQ1+mA+AQaIewI+BYFhRO9L65U+CMC9idEy6s/IZL4Ipw7Wc/f3yqG+AWuPNi98CDlcfwKDCrJ+CZc9u9qFxOAJwAOAFwAuAEwAmAE4D/F4BftnxWlzC6E3YAAAAASUVORK5CYII=';

function isStandardBrandGradient(colors: readonly [string, string], direction: 'horizontal' | 'vertical'): boolean {
  return direction === 'horizontal' && colors[0] === '#f2295c' && colors[1] === '#ff7a3d';
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

interface GradientViewProps {
  /** [start, end] as plain "#rrggbb" hex, or "rgba(r,g,b,a)"/"transparent" strings — the latter two
   * skip hex parsing (alpha fades, e.g. the hero scrim's transparent->dark, need real alpha). */
  colors: readonly [string, string];
  /** 'horizontal' (default, left->right — the reference's badge/CTA/segment direction) or
   * 'vertical' (top->bottom — the hero scrim's direction). */
  direction?: 'horizontal' | 'vertical';
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

function resolveStop(color: string, other: string, useAlpha: boolean, t: number): string {
  if (useAlpha) {
    // rgba(...)/transparent inputs: only alpha is interpolated (start/end share the same RGB), the
    // hero scrim's actual use case (transparent -> a fixed dark tint).
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
  const useAlpha = colors.some((c) => c === 'transparent' || c.startsWith('rgba'));
  const useContinuousBrandBitmap = !useAlpha && isStandardBrandGradient(colors, direction);
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
    <View style={[styles.wrap, style]}>
      {useContinuousBrandBitmap ? (
        <Image
          source={{ uri: BRAND_GRADIENT_DATA_URI }}
          resizeMode="stretch"
          style={StyleSheet.absoluteFill}
        />
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
