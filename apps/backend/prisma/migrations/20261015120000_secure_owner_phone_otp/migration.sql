-- Additive OTP-purpose and ownership metadata for owner login and verified phone linking.
-- Existing OTP rows retain the LEGACY_SHA256 marker and expire naturally within five minutes;
-- new application writes store a keyed HMAC marker. No user or OTP data is rewritten here.
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'OWNER_LOGIN';
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'PHONE_LINK';

ALTER TABLE "otp_requests"
  ADD COLUMN "hashVersion" TEXT NOT NULL DEFAULT 'LEGACY_SHA256',
  ADD COLUMN "subjectUserId" TEXT;

ALTER TABLE "otp_requests"
  ADD CONSTRAINT "otp_requests_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "otp_requests_phone_purpose_createdAt_idx"
  ON "otp_requests"("phone", "purpose", "createdAt");
CREATE INDEX "otp_requests_subjectUserId_purpose_createdAt_idx"
  ON "otp_requests"("subjectUserId", "purpose", "createdAt");
