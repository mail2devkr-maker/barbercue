-- Additive only: existing QR-only salons retain NULL UPI routing fields.
ALTER TABLE "salon_payment_policies"
  ADD COLUMN "upiVpa" VARCHAR(255),
  ADD COLUMN "upiPayeeName" VARCHAR(100);
