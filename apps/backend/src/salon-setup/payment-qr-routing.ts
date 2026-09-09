import { upiVpaSchema, upiPayeeNameSchema } from '@barbercue/shared';

/** Versioned, immutable server-generated upload namespace proves routing came from decoding.
 * Existing manual rows/old keys fail closed without a schema or production data migration.
 * Link writes ALWAYS clear routing, even when linking an object within this namespace.
 * Keep this namespace stable if storage hosts move; both storage drivers preserve the key path. */
export const DECODED_UPI_KEY_PREFIX = 'upi-v1/';
export function paymentQrRouting(salonId: string, policy: {
  paymentQrImageUrl?: string | null; upiVpa?: string | null; upiPayeeName?: string | null;
} | null) {
  const disabled = { upiVpa: null, upiPayeeName: null, upiQrDecoded: false } as const;
  if (!policy?.paymentQrImageUrl) return disabled;
  try {
    const path = new URL(policy.paymentQrImageUrl).pathname;
    const prefix = `/salons/${salonId}/payment-qr/${DECODED_UPI_KEY_PREFIX}`;
    const index = path.lastIndexOf(prefix);
    if (index < 0 || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(path.slice(index + prefix.length))) return disabled;
    const vpa = upiVpaSchema.safeParse(policy.upiVpa);
    const payee = upiPayeeNameSchema.safeParse(policy.upiPayeeName);
    return vpa.success && payee.success
      ? { upiVpa: vpa.data, upiPayeeName: payee.data, upiQrDecoded: true } : disabled;
  } catch { return disabled; }
}
