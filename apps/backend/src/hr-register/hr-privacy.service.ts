import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto';
import { Injectable } from '@nestjs/common';
import { CryptoService } from '../auth/services/crypto.service';

export interface DecisionTokenPayload {
  /** Admin user the review was run for; a token cannot be replayed by another admin. */
  a: string;
  /** Register person ids that were shown to HR. */
  ids: string[];
  /** SHA-256 of the normalized identity that was reviewed. */
  q: string;
  /** Expiry, epoch milliseconds. */
  e: number;
  n: string;
}

const TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Contact protection for the HR register: AES-GCM at rest (existing CryptoService), keyed blind indexes
 * for exact-match lookups (so a database dump cannot be searched for an email or phone), and signed
 * short-lived decision tokens. All keys derive from TOTP_ENCRYPTION_KEY and are derived lazily, so the
 * app still boots without it in environments that never use the register.
 */
@Injectable()
export class HrPrivacyService {
  private readonly keys = new Map<string, Buffer>();

  constructor(private readonly crypto: CryptoService) {}

  private key(purpose: string): Buffer {
    let key = this.keys.get(purpose);
    if (!key) {
      const secret = process.env.TOTP_ENCRYPTION_KEY;
      if (!secret)
        throw new Error(
          'TOTP_ENCRYPTION_KEY must be set to use the HR register',
        );
      key = scryptSync(secret, `fastque-hr-${purpose}-v1`, 32);
      this.keys.set(purpose, key);
    }
    return key;
  }

  encrypt(value: string): string {
    return this.crypto.encrypt(value);
  }

  decrypt(value: string): string {
    return this.crypto.decrypt(value);
  }

  /** Deterministic keyed hash of an already-normalized contact value. */
  blindIndex(normalized: string): string {
    return createHmac('sha256', this.key('contact-index'))
      .update(normalized)
      .digest('hex');
  }

  fingerprint(parts: Array<string | null | undefined>): string {
    return createHash('sha256')
      .update(JSON.stringify(parts.map((part) => part ?? '')))
      .digest('hex');
  }

  signDecision(
    payload: Omit<DecisionTokenPayload, 'e' | 'n'>,
    now = Date.now(),
  ): string {
    const full: DecisionTokenPayload = {
      ...payload,
      e: now + TOKEN_TTL_MS,
      n: randomBytes(8).toString('hex'),
    };
    const body = Buffer.from(JSON.stringify(full)).toString('base64url');
    const signature = createHmac('sha256', this.key('decision-token'))
      .update(body)
      .digest('base64url');
    return `${body}.${signature}`;
  }

  verifyDecision(token: string, now = Date.now()): DecisionTokenPayload | null {
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;
    const expected = createHmac('sha256', this.key('decision-token'))
      .update(body)
      .digest();
    let given: Buffer;
    try {
      given = Buffer.from(signature, 'base64url');
    } catch {
      return null;
    }
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return null;
    try {
      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as DecisionTokenPayload;
      if (
        typeof payload.e !== 'number' ||
        payload.e < now ||
        !Array.isArray(payload.ids) ||
        typeof payload.a !== 'string'
      )
        return null;
      return payload;
    } catch {
      return null;
    }
  }
}
