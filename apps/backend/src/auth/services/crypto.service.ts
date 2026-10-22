import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';

/** Fixed key-derivation salt of the stored format. Changing it would orphan every existing ciphertext. */
export const ENCRYPTION_KEY_SALT = 'barbercue-totp-secret-v1';

/**
 * Symmetric encryption for values that must be "encrypted at rest" per DATABASE.md's note on
 * User.totpSecret — TOTP secrets are read back and used (unlike passwords, which only ever need
 * one-way hashing), so they're encrypted, not hashed. AES-256-GCM, key derived from
 * TOTP_ENCRYPTION_KEY via scrypt. The key is derived lazily (not in the constructor) so the app
 * can still boot without this env var set in environments that never touch admin/TOTP auth.
 *
 * Key rotation: new values are always written with TOTP_ENCRYPTION_KEY. While a rotation is in flight, set the
 * optional, decrypt-only TOTP_ENCRYPTION_KEY_SECONDARY to the OTHER key (the incoming one before the re-encryption
 * run, the outgoing one after it), so a value sealed with either key keeps decrypting and no administrator loses
 * access mid-rollout. A value that neither key can open fails exactly as before.
 * See docs/release/ENCRYPTION_KEY_ROTATION.md.
 */
@Injectable()
export class CryptoService {
  private cachedKey: Buffer | undefined;
  private cachedSecondaryKey: Buffer | null | undefined;

  private derive(secret: string): Buffer {
    return scryptSync(secret, ENCRYPTION_KEY_SALT, 32);
  }

  private get key(): Buffer {
    if (!this.cachedKey) {
      const secret = process.env.TOTP_ENCRYPTION_KEY;
      if (!secret) {
        throw new Error(
          'TOTP_ENCRYPTION_KEY must be set to encrypt or decrypt a TOTP secret',
        );
      }
      this.cachedKey = this.derive(secret);
    }
    return this.cachedKey;
  }

  private get secondaryKey(): Buffer | null {
    if (this.cachedSecondaryKey === undefined) {
      const secondary = process.env.TOTP_ENCRYPTION_KEY_SECONDARY;
      this.cachedSecondaryKey =
        secondary && secondary !== process.env.TOTP_ENCRYPTION_KEY
          ? this.derive(secondary)
          : null;
    }
    return this.cachedSecondaryKey;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [iv, encrypted, authTag]
      .map((buf) => buf.toString('base64'))
      .join('.');
  }

  decrypt(ciphertext: string): string {
    try {
      return this.decryptWith(this.key, ciphertext);
    } catch (error) {
      const secondary = this.secondaryKey;
      if (!secondary) throw error;
      try {
        return this.decryptWith(secondary, ciphertext);
      } catch {
        // Neither key opens it: report the failure against the current key, as if no secondary key were set.
        throw error;
      }
    }
  }

  private decryptWith(key: Buffer, ciphertext: string): string {
    const [ivB64, encryptedB64, tagB64] = ciphertext.split('.');
    if (!ivB64 || !encryptedB64 || !tagB64) {
      throw new Error('Malformed ciphertext');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
