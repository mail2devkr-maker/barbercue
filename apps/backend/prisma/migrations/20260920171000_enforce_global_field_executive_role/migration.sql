-- FastQue CRM defense in depth: internal FIELD_EXECUTIVE roles are global only.
-- Kept separate from the enum-value migration so PostgreSQL commits the new enum value first.

ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_field_executive_global"
  CHECK ("role" <> 'FIELD_EXECUTIVE' OR "salonId" IS NULL);
