import type { RotationTarget } from './rotate';

/**
 * Every column that holds a value sealed with TOTP_ENCRYPTION_KEY (CryptoService format). Adding a feature that
 * encrypts data with that key MUST add its columns here, or a key rotation would silently orphan them.
 *
 * Release candidate (26 requirements): administrator authenticator secrets only. The HR permanent-ID register
 * (separate release, PR #288) adds its contact ciphertexts and recomputes its keyed blind indexes via its own
 * target in that branch.
 */
export const TOTP_SECRETS_TARGET: RotationTarget = {
  name: 'users.totpSecret',
  table: 'users',
  idColumn: 'id',
  columns: ['totpSecret'],
};

export const ROTATION_TARGETS: RotationTarget[] = [TOTP_SECRETS_TARGET];
