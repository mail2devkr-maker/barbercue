-- Durable, privacy-minimal OTP send admission records for cross-replica message ceilings.
-- No phone number, user identity, OTP, provider response, or secret is stored here.
CREATE TYPE "OtpDeliveryAttemptStatus" AS ENUM ('RESERVED', 'ACCEPTED', 'UNKNOWN');

CREATE TABLE "otp_delivery_attempts" (
    "id" TEXT NOT NULL,
    "countryCallingCode" TEXT NOT NULL,
    "status" "OtpDeliveryAttemptStatus" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "otp_delivery_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "otp_delivery_attempts_country_calling_code_check"
      CHECK ("countryCallingCode" ~ '^[1-9][0-9]{0,2}$')
);

CREATE INDEX "otp_delivery_attempts_createdAt_idx"
  ON "otp_delivery_attempts"("createdAt");
CREATE INDEX "otp_delivery_attempts_countryCallingCode_createdAt_idx"
  ON "otp_delivery_attempts"("countryCallingCode", "createdAt");
