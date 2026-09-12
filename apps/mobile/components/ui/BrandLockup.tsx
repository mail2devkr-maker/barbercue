import { Image, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

// Brand closure mission (round 2): the web identity moved to a NEW clean, unboxed lockup — no
// square/card/rim around the FQ monogram, see apps/web/components/ui/BrandLockup.tsx's
// `HEADER_LOCKUP_SRC`. This mobile copy was still on the OLD boxed asset (a rounded-square card
// baked into the pixels behind FQ), which an owner review correctly flagged as a branding
// regression once the web lockup moved on. `fastque-clean-lockup.png` is a byte-for-byte copy of
// apps/web/public/brand/fastque-clean-lockup-transparent.png (verified identical via `cmp`) — not
// redrawn, recolored, or reinterpreted. Already a PNG with real alpha, so no format conversion was
// needed this time (unlike the old webp source, this one was already React-Native-safe).
//
// `fastque-clean-mark.png` is a plain rectangular CROP of that same file's own pixels (the FQ
// monogram's own bounding box, x:[97,313] y:[78,232] in the source) — used where the narrow-header
// layout needs an icon-only presentation instead of the full wordmark. Cropping, not deriving a
// separate "mark" design, is what keeps this the same artwork the mission requires: the old
// fastque-premium-3d-mark.png this replaces was itself a separately-boxed square-card asset (the
// same regression, just in icon form), not a crop of the canonical lockup.
//
// Never edit either file directly; if the web canonical artwork changes again, re-copy/re-crop it
// the same way.
const lockupAsset = require('../../assets/brand/fastque-clean-lockup.png');
const markAsset = require('../../assets/brand/fastque-clean-mark.png');
// Natural pixel size of fastque-clean-lockup.png (958x259) — used below to size the rendered box
// so contain-fit shows it at its real ~3.70:1 aspect ratio instead of a mismatched box, which would
// otherwise letterbox this artwork with dead space on either side.
const LOCKUP_ASPECT_RATIO = 958 / 259;
// Natural pixel size of fastque-clean-mark.png (216x154, ~1.40:1 — the monogram's own bounding box
// is wider than tall, unlike the old square icon-card asset it replaces).
const MARK_ASPECT_RATIO = 216 / 154;
const MARK_HEIGHT = 42;

// Presentation-only rounding, left from when this wrapped the OLD boxed asset (rounding a real
// opaque card's corners). The clean asset has no fill behind FQ, so overflow:'hidden' now clips
// nothing visible — kept anyway so a future asset swap can't silently reintroduce square corners
// without this wrapper already being in place.
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
  // Width follows MARK_ASPECT_RATIO at a fixed height so contain-fit renders the real crop with no
  // letterboxed dead space (the monogram's own bounding box is ~1.40:1, not square).
  markArt: { width: MARK_HEIGHT * MARK_ASPECT_RATIO, height: MARK_HEIGHT },

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
