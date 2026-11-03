import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { buildQrLayout } from '../../lib/owner/qr';
import { font, fontSize, space } from '../../lib/theme';

/**
 * A scannable QR drawn with Views (black modules on a white card, which is what camera apps expect
 * regardless of the app theme). If encoding fails for any reason the caller's fallback text — the
 * plain link — is shown instead, so the owner is never left with a blank box.
 */
export function QrCode({ value, size = 220, fallbackLabel }: { value: string; size?: number; fallbackLabel: string }) {
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

  const module = size / layout.size;
  return (
    <View testID="qr-code" accessible accessibilityRole="image" accessibilityLabel={fallbackLabel} style={[styles.box, { width: size, height: size }]}>
      {layout.rows.map((runs, rowIndex) => (
        <View key={rowIndex} style={{ height: module, width: size }}>
          {runs.map((run) => (
            <View
              key={run.start}
              style={{ position: 'absolute', left: run.start * module, width: run.length * module, height: module, backgroundColor: '#000' }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#fff', alignSelf: 'center', justifyContent: 'center', borderRadius: 8, overflow: 'hidden' },
  fallback: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: '#000', padding: space[3], textAlign: 'center' },
});

