/// <reference types="node" />
import { inflateSync } from 'zlib';
import { createQrMatrix } from '../qr-poster';
import { crc32, qrMatrixToPng, toBase64 } from '../qr-png';

function readChunks(png: Uint8Array) {
  const view = Buffer.from(png);
  expect([...view.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: Array<{ type: string; data: Buffer }> = [];
  let offset = 8;
  while (offset < view.length) {
    const length = view.readUInt32BE(offset);
    const type = view.subarray(offset + 4, offset + 8).toString('ascii');
    const data = view.subarray(offset + 8, offset + 8 + length);
    const crc = view.readUInt32BE(offset + 8 + length);
    expect(crc).toBe(crc32(view.subarray(offset + 4, offset + 8 + length)));
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

it('encodes a valid grayscale PNG whose pixels match the QR modules exactly', () => {
  const matrix = createQrMatrix('https://fastque.com/in/delhi/synthetic-shop');
  const scale = 4;
  const chunks = readChunks(qrMatrixToPng(matrix, scale));
  expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  const width = chunks[0].data.readUInt32BE(0);
  expect(width).toBe(matrix.size * scale);
  expect(chunks[0].data[8]).toBe(8); // bit depth
  expect(chunks[0].data[9]).toBe(0); // grayscale
  const raw = inflateSync(chunks[1].data);
  expect(raw.length).toBe((width + 1) * width);
  for (let y = 0; y < width; y += scale) {
    expect(raw[y * (width + 1)]).toBe(0); // filter none
    for (let x = 0; x < width; x += scale) {
      const dark = matrix.cells[(y / scale) * matrix.size + x / scale];
      expect(raw[y * (width + 1) + 1 + x]).toBe(dark ? 0 : 255);
    }
  }
});

it('base64 matches Node for all padding lengths', () => {
  for (const bytes of [[], [1], [1, 2], [1, 2, 3], [255, 0, 128, 7]]) {
    expect(toBase64(Uint8Array.from(bytes))).toBe(Buffer.from(bytes).toString('base64'));
  }
});

it('splits large images into several stored deflate blocks that still inflate', () => {
  const matrix = createQrMatrix('x'.repeat(200));
  const chunks = readChunks(qrMatrixToPng(matrix, 12));
  expect(chunks[1].data.length).toBeGreaterThan(65535);
  expect(() => inflateSync(chunks[1].data)).not.toThrow();
});
