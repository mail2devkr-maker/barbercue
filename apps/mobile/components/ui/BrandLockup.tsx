import { Image, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

// Mobile brand closure mission — the full lockup is now a byte-for-byte lossless PNG re-encode of
// the exact canonical web artwork (apps/web/public/brand/fastque-final-canonical-logo-v3.webp,
// the same file apps/web/components/ui/BrandLockup.tsx's `headerArtwork` path renders), copied in
// rather than redesigned: verified pixel-identical after decode (both files raw-decode to the same
// byte buffer). Converted to PNG only because it's the format this app's plain <Image> already
// renders everywhere else — React Native's WebP support requires extra native linking this app
// doesn't carry, so it is not a build-safe choice for OTA-delivered branding. Never edit this file
// directly; if the web canonical artwork changes, re-run the same lossless conversion.
const lockupAsset = require('../../assets/brand/fastque-canonical-lockup.png');
const markAsset = require('../../assets/brand/fastque-premium-3d-mark.png');
// Natural pixel size of fastque-canonical-lockup.png (488x163) — used below to size the rendered
// box so contain-fit shows it at its real ~2.99:1 aspect ratio instead of the previous asset's 4:1
// box, which would otherwise letterbox this artwork with dead space on either side.
const LOCKUP_ASPECT_RATIO = 488 / 163;

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
  // Height held at the same visual size the previous asset used at each density; width follows
  // LOCKUP_ASPECT_RATIO so contain-fit renders the real artwork with no letterboxed dead space.
  art: { width: 39 * LOCKUP_ASPECT_RATIO, height: 39, flexShrink: 1 },
  artCompact: { width: 33 * LOCKUP_ASPECT_RATIO, height: 33 },
  markOnly: { flexShrink: 0 },
  markArt: { width: 42, height: 42 },
});
