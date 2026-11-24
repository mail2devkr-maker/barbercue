-- Additive only: several salon types per application, plus the text behind "Other".
ALTER TABLE "salon_onboarding_applications" ADD COLUMN "salonKindOther" VARCHAR(160),
ADD COLUMN "salonKinds" "OnboardingSalonKind"[] DEFAULT ARRAY[]::"OnboardingSalonKind"[];
