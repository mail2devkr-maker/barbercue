-- Offer booking rules: minimum spend, discount cap and Happy Hours (all optional; existing offers unchanged).
ALTER TABLE "offers"
  ADD COLUMN "minimumBookingAmount" DECIMAL(10,2),
  ADD COLUMN "maximumDiscountAmount" DECIMAL(10,2),
  ADD COLUMN "applicableDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "dailyStartTime" VARCHAR(5),
  ADD COLUMN "dailyEndTime" VARCHAR(5);
