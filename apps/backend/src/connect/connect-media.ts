import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * Attachment rules (spec section 20). The file's own bytes decide its type; the client's declared
 * MIME type is never trusted. Anything not on this list is refused.
 */
export type ConnectMediaKind = 'IMAGE' | 'VOICE' | 'FILE';

interface Sniffed {
  mime: string;
  kind: ConnectMediaKind;
  ext: string;
}

export function sniffMedia(buf: Buffer): Sniffed | null {
  if (buf.length < 12) return null;
  const hex = buf.subarray(0, 12).toString('hex');
  const ascii = buf.subarray(0, 12).toString('latin1');
  if (hex.startsWith('ffd8ff'))
    return { mime: 'image/jpeg', kind: 'IMAGE', ext: 'jpg' };
  if (hex.startsWith('89504e470d0a1a0a'))
    return { mime: 'image/png', kind: 'IMAGE', ext: 'png' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP')
    return { mime: 'image/webp', kind: 'IMAGE', ext: 'webp' };
  if (ascii.startsWith('%PDF-'))
    return { mime: 'application/pdf', kind: 'FILE', ext: 'pdf' };
  if (ascii.startsWith('OggS'))
    return { mime: 'audio/ogg', kind: 'VOICE', ext: 'ogg' };
  if (hex.startsWith('1a45dfa3'))
    return { mime: 'audio/webm', kind: 'VOICE', ext: 'webm' };
  // ISO base media (m4a/mp4 audio as recorded by phones): "....ftyp"
  if (ascii.slice(4, 8) === 'ftyp') {
    const brand = ascii.slice(8, 12);
    if (/^(M4A |mp42|isom|M4B |dash|iso5|mp41)/.test(brand))
      return { mime: 'audio/mp4', kind: 'VOICE', ext: 'm4a' };
  }
  if (ascii.startsWith('ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))
    return { mime: 'audio/mpeg', kind: 'VOICE', ext: 'mp3' };
  return null;
}

/** A PDF with embedded JavaScript or auto-actions is refused (no scanner is configured by default). */
export function pdfLooksActive(buf: Buffer): boolean {
  const s = buf.toString('latin1');
  return /\/(JavaScript|JS|Launch|OpenAction|AA|EmbeddedFile)\b/.test(s);
}

export const sha256 = (buf: Buffer) =>
  createHash('sha256').update(buf).digest('hex');

export function safeFileName(name: string | undefined | null): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  return clean || null;
}

function mediaSecret(): string {
  const s = process.env.CONNECT_MEDIA_SECRET || process.env.JWT_ACCESS_SECRET;
  if (!s) throw new Error('No signing secret configured');
  return `connect-media:${s}`;
}

/** Short-lived URL bound to one viewer. The download route re-checks participation too. */
export function signMediaUrl(
  attachmentId: string,
  userId: string,
  ttlSeconds = 300,
  now = Date.now(),
): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const sig = createHmac('sha256', mediaSecret())
    .update(`${attachmentId}.${userId}.${exp}`)
    .digest('base64url');
  return `connect/media/${attachmentId}?u=${encodeURIComponent(userId)}&e=${exp}&s=${sig}`;
}

export function verifyMediaSignature(
  attachmentId: string,
  userId: string,
  exp: number,
  sig: string,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = createHmac('sha256', mediaSecret())
    .update(`${attachmentId}.${userId}.${exp}`)
    .digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
