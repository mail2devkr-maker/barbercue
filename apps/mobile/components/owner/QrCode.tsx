import { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { buildQrLayout } from '../../lib/owner/qr';
import { font, fontSize, space } from '../../lib/theme';

const QR_GOLD = '#FFE15C';
const QR_BLACK = '#000000';
const fastQueMark = require('../../assets/brand/fastque-clean-mark.png');

/**
 * All salons render a REAL, distinct QR derived from the backend's existing queue URL.
 * The approved gold-on-black poster is intentionally an inverted QR (some scanners may not
 * recognise it). Require a physical Android/iOS camera test on printed and screen versions
 * BEFORE publishing to all salons. Keep the public URL/share action available as fallback.
 *
 * High error correction, ISO 4-module quiet zone and the small centered excavated black
 * logo plate avoid changing the token or using a non-functional image-generated QR.
 */
export function QrCode({ value, size = 248, fallbackLabel }: { value: string; size?: number; fallbackLabel: string }) {
  const layout = useMemo(() => {
    try {
      return buildQrLayout(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!layout) {
    return (
      <View testID="qr-fallback" style={[styles.box, { width: size, minHeight: size }]}>
        <Text style={styles.fallback} selectable>
          {fallbackLabel}
        </Text>
      </View>
    );
  }

  const moduleSize = size / layout.size;
  return (
    <View testID="qr-code" accessible accessibilityRole="image" accessibilityLabel={fallbackLabel} style={[styles.box, { width: size, height: size }]}>
      {layout.rows.map((runs, rowIndex) => (
        <View key={rowIndex} style={{ height: moduleSize, width: size }}>
          {runs.map((run) => (
            <View
              key={run.start}
              style={{ position: 'absolute', left: run.start * moduleSize, width: run.length * moduleSize, height: moduleSize, backgroundColor: QR_GOLD }}
            />
          ))}
        </View>
      ))}
      <View pointerEvents="none" style={styles.logoPlate}>
        <Image source={fastQueMark} resizeMode="contain" style={styles.logo} accessibilityIgnoresInvertColors />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: QR_BLACK, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoPlate: {
    position: 'absolute', alignSelf: 'center', alignItems: 'center', justifyContent: 'center',
    width: 50, height: 40, backgroundColor: QR_BLACK, borderRadius: 9,
  },
  logo: { width: 45, height: 33 },
  fallback: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: QR_GOLD, padding: space[3], textAlign: 'center' },
});
