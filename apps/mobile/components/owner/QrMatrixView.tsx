import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { createQrMatrix } from '../../lib/qr-poster';

/** Renders QR modules as native square views, avoiding font-dependent block glyphs. */
export function QrMatrixView({ value, label }: { value: string; label: string }) {
  const matrix = useMemo(() => createQrMatrix(value), [value]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID="qr-matrix"
      style={styles.frame}
    >
      {Array.from({ length: matrix.size }, (_, row) => (
        <View key={`row-${row}`} testID={`qr-matrix-row-${row}`} style={styles.row}>
          {Array.from({ length: matrix.size }, (_, column) => {
            const dark = matrix.cells[row * matrix.size + column];
            return (
              <View
                key={`cell-${column}`}
                testID={`qr-matrix-cell-${row}-${column}`}
                style={[styles.cell, dark ? styles.dark : styles.light]}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 236,
    height: 236,
    maxWidth: '100%',
    aspectRatio: 1,
    backgroundColor: '#ffffff',
    borderRadius: 4,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  row: { flex: 1, flexDirection: 'row' },
  cell: { flex: 1 },
  dark: { backgroundColor: '#111111' },
  light: { backgroundColor: '#ffffff' },
});
