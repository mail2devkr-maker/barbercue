import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { ASSISTANT_LIMITS } from '@barbercue/shared';

/**
 * A previewed write, sealed so the client can only say "yes" or "no" to EXACTLY what was shown.
 * Bound to the user, the shop, the action, its payload and a fingerprint of the state it was
 * previewed against; it expires quickly and is single-use. The executor still re-authorizes and
 * re-checks the before-state, so a replay after the change (or after an account/shop switch) fails.
 */
export interface SealedWrite {
  userId: string;
  salonId: string;
  actionId: string;
  payload: Record<string, unknown>;
  beforeFingerprint: string;
  nonce: string;
  exp: number; // epoch ms
}

const USED_TTL_MS = 10 * 60 * 1000;

function key(): Buffer {
  const base = process.env.JWT_ACCESS_SECRET;
  if (!base || base.length < 16)
    throw new Error('assistant confirmation key unavailable');
  return createHmac('sha256', base)
    .update('fastque-assistant-confirmation-v1')
    .digest();
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class ConfirmationLedger {
  private readonly used = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  seal(input: Omit<SealedWrite, 'nonce' | 'exp'>): {
    token: string;
    expiresAt: string;
  } {
    const exp = this.now() + ASSISTANT_LIMITS.confirmationTtlSeconds * 1000;
    const body = Buffer.from(
      JSON.stringify({ ...input, nonce: randomUUID(), exp }),
    ).toString('base64url');
    const sig = createHmac('sha256', key()).update(body).digest('base64url');
    return { token: `${body}.${sig}`, expiresAt: new Date(exp).toISOString() };
  }

  /** Verifies signature, owner, expiry and single use. Marks the nonce used. */
  open(
    token: string,
    userId: string,
  ): SealedWrite | 'INVALID' | 'EXPIRED' | 'USED' | 'WRONG_USER' {
    const [body, sig] = token.split('.');
    if (!body || !sig) return 'INVALID';
    const expected = createHmac('sha256', key()).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return 'INVALID';
    let sealed: SealedWrite;
    try {
      sealed = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as SealedWrite;
    } catch {
      return 'INVALID';
    }
    if (sealed.userId !== userId) return 'WRONG_USER';
    const now = this.now();
    if (now > sealed.exp) return 'EXPIRED';
    this.prune(now);
    if (this.used.has(sealed.nonce)) return 'USED';
    this.used.set(sealed.nonce, now);
    return sealed;
  }

  private prune(now: number) {
    for (const [nonce, at] of this.used)
      if (now - at > USED_TTL_MS) this.used.delete(nonce);
  }
}
