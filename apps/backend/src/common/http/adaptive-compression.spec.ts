import type { NextFunction, Request, Response } from 'express';
import * as zlib from 'node:zlib';
import {
  adaptiveCompressionMiddleware,
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

  it('compresses a serialized JSON response and emits the negotiation headers', async () => {
    let sentBody: unknown;
    let markSent!: () => void;
    const sent = new Promise<void>((resolve) => {
      markSent = resolve;
    });
    const headers = new Map<string, string>([
      ['content-type', 'application/json; charset=utf-8'],
    ]);

    const response = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      getHeader(name: string) {
        return headers.get(name.toLowerCase());
      },
      setHeader(name: string, value: string | number | readonly string[]) {
        headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value));
        return this;
      },
      removeHeader(name: string) {
        headers.delete(name.toLowerCase());
      },
      send(body?: unknown) {
        sentBody = body;
        markSent();
        return this;
      },
    } as unknown as Response;
    const request = {
      method: 'GET',
      headers: { 'accept-encoding': 'gzip' },
    } as unknown as Request;

    adaptiveCompressionMiddleware(
      request,
      response,
      (() => undefined) as NextFunction,
    );
    response.send(JSON.stringify({ payload: 'FastQue '.repeat(500) }));
    await sent;

    expect(response.getHeader('Content-Encoding')).toBe('gzip');
    expect(String(response.getHeader('Vary'))).toContain('Accept-Encoding');
    expect(Buffer.isBuffer(sentBody)).toBe(true);
    const restored = zlib.gunzipSync(sentBody as Buffer).toString('utf8');
    expect(JSON.parse(restored)).toEqual({ payload: 'FastQue '.repeat(500) });
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
