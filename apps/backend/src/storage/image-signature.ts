import { SALON_PHOTO_UPLOAD } from '@barbercue/shared';

type AllowedImageMime = (typeof SALON_PHOTO_UPLOAD.allowedMimeTypes)[number];

/**
 * Identifies an uploaded image by its magic bytes.
 *
 * The filename extension and the browser-declared `Content-Type` are both attacker-controlled —
 * anyone can POST an executable or an SVG (which can carry script) named `nice-shop.jpg` with
 * `Content-Type: image/jpeg`. Neither is consulted here. What we store, and what we later hand a
 * customer's browser to render, is decided solely by what the first bytes of the file actually
 * are, and the Content-Type written to object storage is this detected value rather than the
 * client's claim.
 *
 * This is detection, not a full decode: it proves the file starts like a JPEG/PNG/WebP, not that
 * the remainder is well-formed. Re-encoding through an image library (which would also strip EXIF
 * — including the GPS coordinates phone cameras embed) is the next hardening step and is
 * deliberately not done here; see the note in salon-photos.service.ts.
 */
export function detectImageMimeType(buffer: Buffer): AllowedImageMime | null {
  if (buffer.length < 12) return null;

  // JPEG — SOI marker FF D8 FF.
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG — the 8-byte signature, including the CR/LF and EOF bytes that catch corrupt transfers.
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP — a RIFF container whose form type is "WEBP". Both markers are required: "RIFF" alone
  // is also how WAV and AVI files begin.
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

/** File extension matching a detected type — derived from the sniffed bytes, never the upload's name. */
export function extensionForMimeType(mimeType: AllowedImageMime): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}
