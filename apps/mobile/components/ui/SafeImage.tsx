import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ImageStyle, ImageResizeMode, StyleProp, ViewStyle } from 'react-native';
import { color, font } from '../../lib/theme';

/**
 * The one place a remote (owner-supplied) photo is rendered on mobile, mirroring
 * apps/web/components/ui/SalonImage.tsx's contract exactly: a URL that 404s or is
 * hotlink-blocked degrades to a neutral "BC" placeholder rather than React Native's default
 * broken-image glyph. `style` is applied to whichever of the two (Image or placeholder View) is
 * actually rendered, so every call site's existing width/height/borderRadius sizing carries over
 * unchanged — this only ever swaps what fills that box, never the box itself.
 *
 * There is no placeholder photograph, same reasoning as the web version: a stock image of
 * someone else's salon would misrepresent the business.
 */
export function SafeImage({
  url,
  alt,
  style,
  resizeMode = 'cover',
}: {
  url: string | null | undefined;
  alt: string;
  style?: StyleProp<ViewStyle & ImageStyle>;
  // Defaults to 'cover' (fill the box, crop as needed) — every existing call site is a fixed-size
  // card/thumbnail where that's correct. A full-screen lightbox is the one place the whole,
  // un-cropped photo is the point, so it passes 'contain' instead.
  resizeMode?: ImageResizeMode;
}) {
  // Tracks the specific URL that failed, not just a boolean — if the `url` prop later changes to
  // a different (potentially working) address, this re-attempts it instead of staying stuck.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = !!url && failedUrl !== url;

  if (showImage) {
    return (
      <Image
        source={{ uri: url }}
        style={style}
        resizeMode={resizeMode}
        accessibilityLabel={alt}
        onError={() => setFailedUrl(url)}
      />
    );
  }

  return (
    <View
      style={[styles.placeholder, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${alt}: ${url ? "photo unavailable" : "no photo yet"}`}
    >
      <View style={styles.badge}>
        <Text style={styles.badgeText}>BC</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: color.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 0.5,
  },
});
