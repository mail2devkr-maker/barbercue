import * as QRCode from 'qrcode/lib/core/qrcode';

/**
 * Turns text into the dark-module runs of a QR code, row by row, so a screen can draw it with a few
 * hundred Views instead of one per module. Pure and synchronous. A quiet zone is added around the
 * symbol (QR scanners need it).
 */
export interface QrRun {
  /** Index of the first dark module in this run (0-based, counting the quiet zone). */
  start: number;
  length: number;
}

export interface QrLayout {
  /** Modules per side INCLUDING the quiet zone. */
  size: number;
  rows: QrRun[][];
}

export const QR_QUIET_ZONE = 2;

export function buildQrLayout(text: string): QrLayout {
  const symbol = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const { size, data } = symbol.modules;
  const total = size + QR_QUIET_ZONE * 2;
  const rows: QrRun[][] = [];
  for (let row = 0; row < total; row += 1) {
    const runs: QrRun[] = [];
    const sourceRow = row - QR_QUIET_ZONE;
    if (sourceRow >= 0 && sourceRow < size) {
      let start = -1;
      for (let col = 0; col <= size; col += 1) {
        const dark = col < size && data[sourceRow * size + col] === 1;
        if (dark && start === -1) start = col;
        if (!dark && start !== -1) {
          runs.push({ start: start + QR_QUIET_ZONE, length: col - start });
          start = -1;
        }
      }
    }
    rows.push(runs);
  }
  return { size: total, rows };
}
