import sharp from 'sharp';

/**
 * Re-encodes an uploaded image as a bounded JPEG before it goes to the self-hosted model: every
 * local runtime decodes JPEG, and a smaller image means far fewer vision tokens (CPU time).
 * 2048 px on the long edge keeps small menu print legible. Rejects anything sharp cannot decode.
 */
export const VISION_MAX_EDGE = 2048;

export async function toVisionJpeg(image: Buffer): Promise<Buffer> {
  return sharp(image, { failOn: 'error', limitInputPixels: 50_000_000 })
    .rotate()
    .resize({
      width: VISION_MAX_EDGE,
      height: VISION_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toBuffer();
}
