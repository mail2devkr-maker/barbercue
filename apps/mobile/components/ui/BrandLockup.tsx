import { Image, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

const lockupAsset = require('../../assets/brand/fastque-premium-3d-lockup.png');
const markAsset = require('../../assets/brand/fastque-premium-3d-mark.png');

type Props = {
  compact?: boolean;
  /** Preserved for existing callers; the canonical lockup already includes the tagline. */
  showTagline?: boolean;
  /** Use the same approved 3D emblem when a narrow header cannot fit the horizontal lockup. */
  markOnly?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Canonical in-app FastQue brand. The bundled PNG is the owner-approved 3D artwork: no remote
 * URL, data URI, handwritten wordmark, or synthetic FQ circle can drift from the web identity.
 */
export function BrandLockup({ compact = false, showTagline = false, markOnly = false, style }: Props) {
  void showTagline;

  return (
    <View
      style={[styles.root, compact && styles.rootCompact, markOnly && styles.markOnly, style]}
      accessibilityLabel={markOnly ? 'FastQue' : 'FastQue — Good Looks, Less Waiting'}
      accessibilityRole="image"
    >
      <Image
        source={markOnly ? markAsset : lockupAsset}
        style={[styles.art, compact && styles.artCompact, markOnly && styles.markArt]}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', flexShrink: 1, minWidth: 0 },
  rootCompact: {},
  art: { width: 154, height: 39, flexShrink: 1 },
  artCompact: { width: 128, height: 33 },
  markOnly: { flexShrink: 0 },
  markArt: { width: 42, height: 42 },
});
