import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { createQrMatrix } from '../../lib/qr-poster';

export interface QrCenterExcavation {
  /** Fraction of the full QR width (quiet zone included) cleared for the centre mark. */
  widthRatio: number;
  /** Fraction of the full QR height (quiet zone included) cleared for the centre mark. */
  heightRatio: number;
}

/**
 * Module indexes cleared under a centre logo — website parity with qrcode.react's
 * `imageSettings.excavate`, which blanks every module the image overlaps. Level-H error
 * correction keeps the code readable with the centre removed.
 */
export function excavatedCells(size: number, excavation: QrCenterExcavation): Set<number> {
  const cleared = new Set<number>();
  const w = size * excavation.widthRatio;
  const h = size * excavation.heightRatio;
  const x0 = Math.floor((size - w) / 2);
  const y0 = Math.floor((size - h) / 2);
  const x1 = Math.ceil((size + w) / 2);
  const y1 = Math.ceil((size + h) / 2);
  for (let row = y0; row < y1; row += 1) {
    for (let column = x0; column < x1; column += 1) cleared.add(row * size + column);
  }
  return cleared;
}

/** Renders QR modules as native square views, avoiding font-dependent block glyphs. */
export function QrMatrixView({
  value,
  label,
  fgColor = '#111111',
  bgColor = '#ffffff',
  size = 236,
  excavation,
  center,
}: {
  value: string;
  label: string;
  fgColor?: string;
  bgColor?: string;
  size?: number;
  excavation?: QrCenterExcavation;
  /** Rendered over the excavated centre (for example the FastQue mark). */
  center?: ReactNode;
}) {
  const matrix = useMemo(() => createQrMatrix(value), [value]);
  const widthRatio = excavation?.widthRatio;
  const heightRatio = excavation?.heightRatio;
  const cleared = useMemo(
    () => (widthRatio && heightRatio ? excavatedCells(matrix.size, { widthRatio, heightRatio }) : null),
    [matrix.size, widthRatio, heightRatio],
  );

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID="qr-matrix"
      style={[styles.frame, { width: size, height: size, backgroundColor: bgColor }]}
    >
      {Array.from({ length: matrix.size }, (_, row) => (
        <View key={`row-${row}`} testID={`qr-matrix-row-${row}`} style={styles.row}>
          {Array.from({ length: matrix.size }, (_, column) => {
            const index = row * matrix.size + column;
            const dark = matrix.cells[index] && !cleared?.has(index);
            return (
              <View
                key={`cell-${column}`}
                testID={`qr-matrix-cell-${row}-${column}`}
                style={[styles.cell, { backgroundColor: dark ? fgColor : bgColor }]}
              />
            );
          })}
        </View>
      ))}
      {center && widthRatio && heightRatio ? (
        <View pointerEvents="none" style={styles.centerLayer}>
          <View style={{ width: size * widthRatio, height: size * heightRatio, alignItems: 'center', justifyContent: 'center' }}>
            {center}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    maxWidth: '100%',
    aspectRatio: 1,
    borderRadius: 4,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  row: { flex: 1, flexDirection: 'row' },
  cell: { flex: 1 },
  centerLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
