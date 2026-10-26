-- Sign in with Apple uses a stable provider subject, just like Google. The one-use nonce table
-- stores only a digest and is consumed atomically with identity/session creation.
ALTER TYPE "AuthProvider" ADD VALUE IF NOT EXISTS 'APPLE';

ALTER TABLE "auth_identities"
    ADD COLUMN "provider_refresh_token_encrypted" TEXT;

CREATE TABLE "apple_auth_nonces" (
    "nonce_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "apple_auth_nonces_pkey" PRIMARY KEY ("nonce_hash")
);

CREATE INDEX "apple_auth_nonces_expires_at_idx" ON "apple_auth_nonces"("expires_at");
