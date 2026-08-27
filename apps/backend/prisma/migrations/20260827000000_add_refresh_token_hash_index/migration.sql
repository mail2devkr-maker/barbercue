-- Every login, refresh, revoke, and session-list call looks refresh_tokens up by tokenHash
-- (TokenService) — the single hottest query in the whole auth system, previously running as a
-- full table scan (no index existed on this column at all). tokenHash is 256 bits of random hex,
-- so a plain (non-unique) index is sufficient; see schema.prisma's RefreshToken model comment.
CREATE INDEX "refresh_tokens_tokenHash_idx" ON "refresh_tokens"("tokenHash");
