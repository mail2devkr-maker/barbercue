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
// box so contain-fit shows it at its real ~2.99:1 aspect ratio instead of a mismatched box, which
// would otherwise letterbox this artwork with dead space on either side.
const LOCKUP_ASPECT_RATIO = 488 / 163;

// Presentation-only rounding (mobile auth logo sizing/rounding hotfix) — the canonical PNG's own
// pixels are never touched; corners are clipped by a wrapper View's overflow:'hidden', not the
// Image's own borderRadius, which Android does not always honor reliably on its own. Applies only
// to the full lockup, never to markOnly (the FQ-only mark and the app icon keep their existing
// square-cut presentation untouched, per that mission's explicit scope).
const LOCKUP_RADIUS = 14;
const AUTH_LOCKUP_RADIUS = 18;
// Auth variant's responsive width: ~78% of screen width lands at ~280px on the owner's reference
// ~360px Android screen (the requested 270-290px range), while naturally scaling down on a 320px
// screen and never growing unreasonably large on a tablet.
const AUTH_WIDTH_PERCENT = '78%';
const AUTH_MAX_WIDTH = 290;

type Variant = 'default' | 'auth';

type Props = {
  compact?: boolean;
  /** Preserved for existing callers; the canonical lockup already includes the tagline. */
  showTagline?: boolean;
  /** Use the same approved 3D emblem when a narrow header cannot fit the horizontal lockup. */
  markOnly?: boolean;
  /**
   * 'auth' renders the full lockup at login-screen presentation size (~270-290px wide on a
   * typical phone, responsive below that) — for the Customer/Owner/Staff login screens only.
   * Ignored when markOnly is set (the mark has its own fixed icon-style size regardless).
   */
  variant?: Variant;
  style?: StyleProp<ViewStyle>;
};

/**
 * Canonical in-app FastQue brand. The bundled PNG is the owner-approved 3D artwork: no remote
 * URL, data URI, handwritten wordmark, or synthetic FQ circle can drift from the web identity.
 */
export function BrandLockup({
  compact = false,
  showTagline = false,
  markOnly = false,
  variant = 'default',
  style,
}: Props) {
  void showTagline;

  if (variant === 'auth' && !markOnly) {
    return (
      <View
        style={[styles.authRoot, style]}
        accessibilityLabel="FastQue — Good Looks, Less Waiting"
        accessibilityRole="image"
      >
        <View style={styles.authClip}>
          <Image
            source={lockupAsset}
            style={styles.authArt}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.root, compact && styles.rootCompact, markOnly && styles.markOnly, style]}
      accessibilityLabel={markOnly ? 'FastQue' : 'FastQue — Good Looks, Less Waiting'}
      accessibilityRole="image"
    >
      {markOnly ? (
        <Image
          source={markAsset}
          style={styles.markArt}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.lockupClip, compact ? styles.lockupClipCompact : styles.lockupClipDefault]}>
          <Image
            source={lockupAsset}
            style={styles.lockupArt}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', flexShrink: 1, minWidth: 0 },
  rootCompact: {},
  markOnly: { flexShrink: 0 },
  markArt: { width: 42, height: 42 },

  // Height held at the same visual size the pre-rounding asset used at each density; width
  // follows LOCKUP_ASPECT_RATIO so contain-fit renders the real artwork with no letterboxed dead
  // space, and the clip box matches that same box exactly so rounding clips the image itself.
  lockupClipDefault: { width: 39 * LOCKUP_ASPECT_RATIO, height: 39, flexShrink: 1 },
  lockupClipCompact: { width: 33 * LOCKUP_ASPECT_RATIO, height: 33 },
  lockupClip: { borderRadius: LOCKUP_RADIUS, overflow: 'hidden' },
  lockupArt: { width: '100%', height: '100%' },

  // Auth (login-screen) presentation — width-percentage + aspectRatio rather than a JS-computed
  // pixel width, so it scales safely across 320-412px+ devices with no extra measurement logic.
  authRoot: { width: '100%', alignItems: 'center' },
  authClip: {
    width: AUTH_WIDTH_PERCENT,
    maxWidth: AUTH_MAX_WIDTH,
    aspectRatio: LOCKUP_ASPECT_RATIO,
    borderRadius: AUTH_LOCKUP_RADIUS,
    overflow: 'hidden',
  },
  authArt: { width: '100%', height: '100%' },
});
