import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';
import { ENCRYPTION_KEY_SALT } from '../../auth/services/crypto.service';

/**
 * The stored ciphertext format of CryptoService, as pure functions over an explicit key (the service itself only ever
 * knows the key in the process environment). `iv.ciphertext.tag`, each base64, AES-256-GCM, key = scrypt(secret, salt).
 * The spec proves byte-level interchange with CryptoService in both directions.
 */
export type DerivedKey = Buffer;

export function deriveKey(secret: string): DerivedKey {
  return scryptSync(secret, ENCRYPTION_KEY_SALT, 32);
}

export function seal(key: DerivedKey, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return [iv, encrypted, cipher.getAuthTag()]
    .map((buf) => buf.toString('base64'))
    .join('.');
}

/** Opens a value or throws (wrong key, tampering and malformed input are indistinguishable by design). */
export function open(key: DerivedKey, ciphertext: string): string {
  const [ivB64, encryptedB64, tagB64] = ciphertext.split('.');
  if (!ivB64 || !encryptedB64 || !tagB64)
    throw new Error('Malformed ciphertext');
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

export function tryOpen(key: DerivedKey, ciphertext: string): string | null {
  try {
    return open(key, ciphertext);
  } catch {
    return null;
  }
}
