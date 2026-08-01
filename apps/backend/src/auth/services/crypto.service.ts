import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';

/**
 * Symmetric encryption for values that must be "encrypted at rest" per DATABASE.md's note on
 * User.totpSecret — TOTP secrets are read back and used (unlike passwords, which only ever need
 * one-way hashing), so they're encrypted, not hashed. AES-256-GCM, key derived from
 * TOTP_ENCRYPTION_KEY via scrypt. The key is derived lazily (not in the constructor) so the app
 * can still boot without this env var set in environments that never touch admin/TOTP auth.
 */
@Injectable()
export class CryptoService {
  private cachedKey: Buffer | undefined;

  private get key(): Buffer {
    if (!this.cachedKey) {
      const secret = process.env.TOTP_ENCRYPTION_KEY;
      if (!secret) {
        throw new Error(
          'TOTP_ENCRYPTION_KEY must be set to encrypt or decrypt a TOTP secret',
        );
      }
      this.cachedKey = scryptSync(secret, 'barbercue-totp-secret-v1', 32);
    }
    return this.cachedKey;
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
    const [ivB64, encryptedB64, tagB64] = ciphertext.split('.');
    if (!ivB64 || !encryptedB64 || !tagB64) {
      throw new Error('Malformed ciphertext');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
