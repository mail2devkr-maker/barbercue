-- Verification requests must describe exactly one valid subject. Application validation already
-- enforces this shape; this additive CHECK prevents impossible rows from entering through a
-- future code path, manual SQL, or a race. It does not modify existing data.
ALTER TABLE "verification_requests"
ADD CONSTRAINT "verification_requests_subject_shape_check"
CHECK (
  (
    "subjectType" = 'SHOP'
    AND "salonId" IS NOT NULL
    AND "staffId" IS NULL
  )
  OR
  (
    "subjectType" = 'PROFESSIONAL'
    AND "salonId" IS NULL
    AND "staffId" IS NOT NULL
  )
);
