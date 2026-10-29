// The app draws its own QR with View elements, so it only needs the encoder core of the pure-JS
// `qrcode` package (no canvas, no PNG, no Node APIs). This declares just the part that is used.
declare module 'qrcode/lib/core/qrcode' {
  export interface QrBitMatrix {
    size: number;
    /** Row-major, `size * size` entries; 1 = dark module. */
    data: ArrayLike<number>;
  }
  export interface QrSymbol {
    modules: QrBitMatrix;
  }
  export function create(text: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): QrSymbol;
}
