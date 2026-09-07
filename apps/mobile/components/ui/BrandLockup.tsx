import { Image, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  FASTQUE_BRAND_COLORS,
  FASTQUE_BRAND_ICON_DATA_URI,
  FASTQUE_BRAND_TAGLINE,
} from '@barbercue/shared';
import { font } from '../../lib/theme';

type Props = {
  compact?: boolean;
  showTagline?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Canonical FastQue in-app brand lockup.
 *
 * Both mobile and web read the exact same approved icon artwork + brand tokens from
 * @barbercue/shared, so the app can no longer drift into a separate FQ badge/wordmark treatment.
 */
export function BrandLockup({ compact = false, showTagline = false, style }: Props) {
  return (
    <View style={[styles.root, compact && styles.rootCompact, style]}>
      <Image
        source={{ uri: FASTQUE_BRAND_ICON_DATA_URI }}
        style={[styles.icon, compact && styles.iconCompact]}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
      <View style={styles.copy}>
        <Text style={[styles.wordmark, compact && styles.wordmarkCompact]} accessibilityLabel="FastQue">
          <Text style={styles.fast}>Fast</Text>
          <Text style={styles.que}>Que</Text>
        </Text>
        {showTagline && (
          <Text style={[styles.tagline, compact && styles.taglineCompact]} numberOfLines={1}>
            {FASTQUE_BRAND_TAGLINE}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    flexShrink: 1,
    minWidth: 0,
  },
  rootCompact: { gap: 7 },
  icon: { width: 42, height: 42, flexShrink: 0 },
  iconCompact: { width: 34, height: 34 },
  copy: { flexShrink: 1, minWidth: 0 },
  wordmark: {
    fontFamily: font.bodyBold,
    fontSize: 22,
    lineHeight: 24,
    letterSpacing: -0.8,
  },
  wordmarkCompact: { fontSize: 18.5, lineHeight: 21 },
  fast: { color: FASTQUE_BRAND_COLORS.ink },
  que: { color: FASTQUE_BRAND_COLORS.gradientStart },
  tagline: {
    fontFamily: font.bodyBold,
    fontSize: 6.4,
    lineHeight: 9,
    letterSpacing: 1.12,
    color: FASTQUE_BRAND_COLORS.ink,
    opacity: 0.68,
    marginTop: 1,
  },
  taglineCompact: { fontSize: 5.8, letterSpacing: 0.9 },
});
