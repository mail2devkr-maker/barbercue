-- Add a distinct admin-dashboard viewer role. This role is intentionally not granted
-- PLATFORM_ADMIN authority and is scoped to the ADMIN session audience only.
ALTER TYPE "Role" ADD VALUE 'PLATFORM_VIEWER';
