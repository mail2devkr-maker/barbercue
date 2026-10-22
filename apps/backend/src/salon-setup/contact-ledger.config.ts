const MIN_KEY_LENGTH = 32;

/**
 * The consent ledger is off unless it is explicitly enabled AND a hash key is configured. An environment that sets
 * only one of the two stays closed, so a stray flag or a stray key can never switch the ledger on by itself.
 */
export function isContactLedgerConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    env.CONTACT_LEDGER_ENABLED === 'true' &&
    (env.CONTACT_LEDGER_HASH_KEY ?? '').length >= MIN_KEY_LENGTH
  );
}
