declare module 'qrcode/lib/core/qrcode' {
  export interface QrModules {
    size: number;
    data: Uint8Array;
  }

  export interface QrCode {
    modules: QrModules;
  }

  export function create(
    value: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
  ): QrCode;
}
