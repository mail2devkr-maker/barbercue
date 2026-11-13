import type { QrMatrix } from './qr-poster';

/**
 * A crisp black-on-white PNG of a QR matrix, encoded in plain TypeScript (no canvas, no native module)
 * so the owner can save or share the shop QR as an image — parity with the website's "Download QR (PNG)".
 * Grayscale 8-bit, zlib "stored" (uncompressed) deflate blocks: always valid, and small enough for a QR.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, data: Uint8Array): number[] {
  const typeBytes = Array.from(type, (ch) => ch.charCodeAt(0));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** zlib wrapper around stored deflate blocks (max 65535 bytes each). */
function zlibStored(raw: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  for (let offset = 0; offset < raw.length || offset === 0; offset += 65535) {
    const block = raw.subarray(offset, Math.min(offset + 65535, raw.length));
    const last = offset + 65535 >= raw.length ? 1 : 0;
    out.push(last, block.length & 0xff, (block.length >>> 8) & 0xff, ~block.length & 0xff, (~block.length >>> 8) & 0xff);
    for (let i = 0; i < block.length; i++) out.push(block[i]);
    if (raw.length === 0) break;
  }
  out.push(...u32(adler32(raw)));
  return Uint8Array.from(out);
}

/** PNG bytes for `matrix` (quiet zone already included) at `scale` pixels per module. */
export function qrMatrixToPng(matrix: QrMatrix, scale = 12): Uint8Array {
  const width = matrix.size * scale;
  const rowBytes = width + 1; // filter byte + one grayscale byte per pixel
  const raw = new Uint8Array(rowBytes * width);
  for (let y = 0; y < width; y++) {
    raw[y * rowBytes] = 0; // filter: none
    const row = Math.floor(y / scale);
    for (let x = 0; x < width; x++) {
      raw[y * rowBytes + 1 + x] = matrix.cells[row * matrix.size + Math.floor(x / scale)] ? 0 : 255;
    }
  }
  const header = Uint8Array.from([...u32(width), ...u32(width), 8, 0, 0, 0, 0]); // 8-bit grayscale
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', header),
    ...chunk('IDAT', zlibStored(raw)),
    ...chunk('IEND', new Uint8Array(0)),
  ]);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + (i + 1 < bytes.length ? B64[(n >>> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}
