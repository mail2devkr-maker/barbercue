import * as zlib from 'node:zlib';
import {
  compressBuffer,
  getRuntimeSupportedEncodings,
  negotiateContentEncoding,
} from './adaptive-compression';

describe('adaptive HTTP compression', () => {
  it('prefers zstd when the client and runtime support all FastQue codecs', () => {
    expect(
      negotiateContentEncoding('gzip, deflate, br, zstd', ['zstd', 'br', 'gzip']),
    ).toBe('zstd');
  });

  it('falls back to brotli when zstd is unavailable', () => {
    expect(negotiateContentEncoding('zstd, br, gzip', ['br', 'gzip'])).toBe('br');
  });

  it('falls back to gzip when that is the only supported FastQue codec', () => {
    expect(negotiateContentEncoding('deflate, gzip', ['zstd', 'br', 'gzip'])).toBe(
      'gzip',
    );
  });

  it('falls back to identity when the client advertises no compatible codec', () => {
    expect(negotiateContentEncoding('deflate', ['zstd', 'br', 'gzip'])).toBe(
      'identity',
    );
  });

  it('respects an explicit q=0 opt-out', () => {
    expect(
      negotiateContentEncoding('zstd;q=0, br;q=1, gzip;q=0.5', [
        'zstd',
        'br',
        'gzip',
      ]),
    ).toBe('br');
  });

  it('respects client q-values before using FastQue preference as a tie-breaker', () => {
    expect(
      negotiateContentEncoding('zstd;q=0.5, br;q=1, gzip;q=0.8', [
        'zstd',
        'br',
        'gzip',
      ]),
    ).toBe('br');
  });

  it('uses FastQue preference order when q-values are equal', () => {
    expect(
      negotiateContentEncoding('gzip;q=1, br;q=1, zstd;q=1', [
        'zstd',
        'br',
        'gzip',
      ]),
    ).toBe('zstd');
  });

  it('supports wildcard negotiation', () => {
    expect(negotiateContentEncoding('*;q=1', ['zstd', 'br', 'gzip'])).toBe(
      'zstd',
    );
  });

  it('round-trips gzip', async () => {
    const source = Buffer.from(JSON.stringify({ payload: 'FastQue '.repeat(500) }));
    const compressed = await compressBuffer(source, 'gzip');
    const restored = zlib.gunzipSync(compressed);
    expect(restored.equals(source)).toBe(true);
  });

  it('round-trips brotli', async () => {
    const source = Buffer.from(JSON.stringify({ payload: 'FastQue '.repeat(500) }));
    const compressed = await compressBuffer(source, 'br');
    const restored = zlib.brotliDecompressSync(compressed);
    expect(restored.equals(source)).toBe(true);
  });

  it('round-trips zstd when the runtime provides it', async () => {
    if (!getRuntimeSupportedEncodings().includes('zstd')) return;

    const source = Buffer.from(JSON.stringify({ payload: 'FastQue '.repeat(500) }));
    const compressed = await compressBuffer(source, 'zstd');
    const zlibWithZstd = zlib as typeof zlib & {
      zstdDecompressSync?: (input: Buffer) => Buffer;
    };
    expect(typeof zlibWithZstd.zstdDecompressSync).toBe('function');
    const restored = zlibWithZstd.zstdDecompressSync?.(compressed);
    expect(restored?.equals(source)).toBe(true);
  });
});
