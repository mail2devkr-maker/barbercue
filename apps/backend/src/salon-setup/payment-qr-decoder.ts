import { Worker } from 'node:worker_threads';
import { parseUpiQrPayload, type SetSalonUpiInput } from '@barbercue/shared';

// Run image/QR work off the Nest event loop. Bounded pixels, output, concurrency and deadline.
// Only local bytes are passed; never fetch a URL or log payloads/QR contents.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const sharp = require(workerData.sharp);
const jsQR = require(workerData.jsqr);
(async () => {
  try {
    const { data, info } = await sharp(Buffer.from(workerData.bytes), { limitInputPixels: 25000000, failOn: 'error' })
      .rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: 'attemptBoth' });
    parentPort.postMessage(code ? code.data : null);
  } catch { parentPort.postMessage(null); }
})();
`;
let activeDecoders = 0;

export async function decodePaymentQr(buffer: Buffer): Promise<SetSalonUpiInput | null> {
  // Saturation falls back to QR-only; no unbounded worker queue or upload failure.
  if (activeDecoders >= 2) return null;
  activeDecoders++;
  try {
    const payload = await new Promise<string | null>((resolve) => {
      const worker = new Worker(WORKER_SOURCE, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 128 },
        workerData: { bytes: buffer, sharp: require.resolve('sharp'), jsqr: require.resolve('jsqr') } });
      let finished = false;
      const finish = (value: string | null) => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        void worker.terminate().then(() => resolve(value), () => resolve(value));
      };
      const timer = setTimeout(() => finish(null), 5000);
      worker.once('message', (value: unknown) => finish(typeof value === 'string' ? value : null));
      worker.once('error', () => finish(null));
      worker.once('exit', () => finish(null));
    });
    return payload ? parseUpiQrPayload(payload) : null;
  } catch { return null; }
  finally { activeDecoders--; }
}
