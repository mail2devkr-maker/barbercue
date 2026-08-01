/** One key per mutating attempt (booking create/cancel) — regenerate per user action, keep
 * stable across automatic retries of that same attempt so the server's IdempotencyKey table can
 * correctly dedupe/replay. `crypto.randomUUID()` is available in every evergreen browser. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
