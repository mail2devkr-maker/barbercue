import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * A real two-stop linear gradient with zero new dependencies: neither react-native-svg nor
 * expo-linear-gradient is installed in this app, and either would be a new NATIVE dependency,
 * forcing a rebuild before the next OTA update (see lib/theme.ts's brandGradientStart/End comment
 * — this codebase already made the identical call for RoleSelectScreen's hero scrim). A row of
 * STOPS thin, incrementally-interpolated solid-color strips reads as a smooth gradient at the
 * button/badge/pill sizes this app actually renders it at (nothing screen-width-scale). Left-to-
 * right only, matching the reference's pink->orange direction — this app has no vertical/diagonal
 * gradient usage to justify the extra complexity of a second axis.
 */
const STOPS = 24;

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
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={direction === 'horizontal' ? styles.row : styles.column}>
          {stops.map((backgroundColor, i) => (
            <View key={i} style={[styles.stop, { backgroundColor }]} />
          ))}
        </View>
      </View>
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
