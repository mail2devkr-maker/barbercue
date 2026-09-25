import type { NextFunction, Request, Response } from 'express';
import * as zlib from 'node:zlib';

export type FastQueContentEncoding = 'zstd' | 'br' | 'gzip' | 'identity';

const SERVER_PREFERENCE: readonly Exclude<FastQueContentEncoding, 'identity'>[] = [
  'zstd',
  'br',
  'gzip',
];
const DEFAULT_THRESHOLD_BYTES = 1024;

type ZstdCompressCallback = (error: Error | null, result: Buffer) => void;
type ZstdCompressFn = (
  input: Buffer,
  options: Record<string, unknown>,
  callback: ZstdCompressCallback,
) => void;

function zstdCompressFn(): ZstdCompressFn | null {
  const candidate = (zlib as typeof zlib & { zstdCompress?: ZstdCompressFn }).zstdCompress;
  return typeof candidate === 'function' ? candidate : null;
}

export function getRuntimeSupportedEncodings(): Exclude<FastQueContentEncoding, 'identity'>[] {
  const encodings: Exclude<FastQueContentEncoding, 'identity'>[] = [];
  if (zstdCompressFn()) encodings.push('zstd');
  encodings.push('br', 'gzip');
  return encodings;
}

function parseAcceptEncoding(header: string | undefined): Map<string, number> {
  const qualities = new Map<string, number>();
  if (!header?.trim()) return qualities;

  for (const item of header.split(',')) {
    const [rawName, ...params] = item.trim().split(';');
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;

    let quality = 1;
    for (const param of params) {
      const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
      if (!match) continue;
      const parsed = Number(match[1]);
      quality = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
    }

    const existing = qualities.get(name);
    if (existing === undefined || quality > existing) qualities.set(name, quality);
  }

  return qualities;
}

/**
 * Standard HTTP content negotiation with FastQue's server preference used as the tie-breaker:
 * zstd -> br -> gzip -> identity.
 *
 * Client q-values are respected. A q=0 explicitly disables that encoding. If the client supplies
 * no usable encoding, FastQue fails open to identity rather than risking an unreadable response.
 */
export function negotiateContentEncoding(
  acceptEncoding: string | undefined,
  runtimeSupported = getRuntimeSupportedEncodings(),
): FastQueContentEncoding {
  if (!acceptEncoding?.trim()) return 'identity';

  const qualities = parseAcceptEncoding(acceptEncoding);
  const wildcardQuality = qualities.get('*');
  const qualityFor = (name: string): number =>
    qualities.has(name) ? (qualities.get(name) ?? 0) : (wildcardQuality ?? 0);

  const supportedSet = new Set(runtimeSupported);
  const candidates = SERVER_PREFERENCE
    .filter((encoding) => supportedSet.has(encoding))
    .map((encoding, priority) => ({
      encoding,
      quality: qualityFor(encoding),
      priority,
    }))
    .filter(({ quality }) => quality > 0)
    .sort((left, right) => right.quality - left.quality || left.priority - right.priority);

  return candidates[0]?.encoding ?? 'identity';
}

function appendVaryAcceptEncoding(response: Response): void {
  const existing = response.getHeader('Vary');
  const values = Array.isArray(existing)
    ? existing.join(',')
    : existing === undefined
      ? ''
      : String(existing);
  const tokens = values
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!tokens.some((value) => value.toLowerCase() === 'accept-encoding')) {
    tokens.push('Accept-Encoding');
    response.setHeader('Vary', tokens.join(', '));
  }
}

function isCompressibleContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase().split(';', 1)[0]?.trim() ?? '';

  if (normalized.startsWith('text/')) return normalized !== 'text/event-stream';
  if (normalized === 'image/svg+xml') return true;

  return (
    normalized === 'application/json' ||
    normalized.endsWith('+json') ||
    normalized === 'application/javascript' ||
    normalized === 'application/x-javascript' ||
    normalized === 'application/xml' ||
    normalized.endsWith('+xml') ||
    normalized === 'application/graphql-response+json' ||
    normalized === 'application/manifest+json'
  );
}

function bodyToBuffer(body: unknown): Buffer | null {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  return null;
}

export async function compressBuffer(
  input: Buffer,
  encoding: Exclude<FastQueContentEncoding, 'identity'>,
): Promise<Buffer> {
  if (encoding === 'zstd') {
    const compress = zstdCompressFn();
    if (!compress) throw new Error('Zstd compression is not available in this Node.js runtime.');

    const compressionLevelKey = (
      zlib.constants as typeof zlib.constants & { ZSTD_c_compressionLevel?: number }
    ).ZSTD_c_compressionLevel;
    const options =
      compressionLevelKey === undefined
        ? {}
        : { params: { [compressionLevelKey]: 3 } };

    return new Promise<Buffer>((resolve, reject) => {
      compress(input, options, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  }

  if (encoding === 'br') {
    return new Promise<Buffer>((resolve, reject) => {
      zlib.brotliCompress(
        input,
        {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
          },
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        },
      );
    });
  }

  return new Promise<Buffer>((resolve, reject) => {
    zlib.gzip(input, { level: 6 }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function shouldAttemptCompression(
  request: Request,
  response: Response,
  body: Buffer,
  thresholdBytes: number,
): boolean {
  if (request.method === 'HEAD') return false;
  if (response.statusCode < 200 || [204, 205, 304].includes(response.statusCode)) return false;
  if (body.byteLength < thresholdBytes) return false;
  if (response.headersSent || response.writableEnded) return false;
  if (request.headers.range || response.getHeader('Content-Range')) return false;

  const currentEncoding = response.getHeader('Content-Encoding');
  if (currentEncoding && String(currentEncoding).toLowerCase() !== 'identity') return false;

  const cacheControl = response.getHeader('Cache-Control');
  if (cacheControl && /(?:^|,)\s*no-transform\b/i.test(String(cacheControl))) return false;

  const contentType = response.getHeader('Content-Type');
  return isCompressibleContentType(
    contentType === undefined ? undefined : String(contentType),
  );
}

/**
 * Compresses ordinary HTTP response bodies after Express/Nest has serialized them.
 *
 * Web and native clients already advertise codecs through Accept-Encoding and transparently
 * decompress Content-Encoding. We therefore never force a codec from application JavaScript.
 * Raster images, audio/video, range responses, SSE, already-encoded bodies and small responses
 * are deliberately left untouched.
 */
export function adaptiveCompressionMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const originalSend = response.send.bind(response);
  let compressionStarted = false;

  response.send = ((body?: unknown) => {
    if (compressionStarted) return response;

    const rawBody = bodyToBuffer(body);
    if (!rawBody || !shouldAttemptCompression(request, response, rawBody, DEFAULT_THRESHOLD_BYTES)) {
      return originalSend(body);
    }

    appendVaryAcceptEncoding(response);
    const encoding = negotiateContentEncoding(request.headers['accept-encoding']);
    if (encoding === 'identity') return originalSend(body);

    compressionStarted = true;
    void compressBuffer(rawBody, encoding)
      .then((compressed) => {
        if (response.writableEnded) return;

        response.removeHeader('Content-Length');
        response.removeHeader('ETag');
        response.setHeader('Content-Encoding', encoding);
        originalSend(compressed);
      })
      .catch(() => {
        if (response.writableEnded) return;

        response.removeHeader('Content-Encoding');
        response.removeHeader('Content-Length');
        originalSend(body);
      });

    return response;
  }) as Response['send'];

  next();
}
