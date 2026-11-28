-- Additive only: a "Co-founder" contributor type next to Founder. Existing rows are unchanged.
ALTER TYPE "FinanceContributorType" ADD VALUE IF NOT EXISTS 'CO_FOUNDER' AFTER 'FOUNDER';
