-- Owner-operations mission, part 1 of 2: enum types only.
--
-- Kept in its own migration because PostgreSQL does not allow a newly added enum value
-- (BookingSource.IN_SHOP) to be referenced in the same transaction that adds it; the CHECK
-- constraint that uses it lives in the next migration. Purely additive: no existing row,
-- column or constraint is touched.

-- CreateEnum
CREATE TYPE "CancellationActor" AS ENUM ('CUSTOMER', 'OWNER', 'STAFF', 'SYSTEM', 'ADMIN');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceSourceType" AS ENUM ('BOOKING', 'QUEUE_ENTRY');

-- CreateEnum
CREATE TYPE "InvoiceTaxMode" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');

-- CreateEnum
CREATE TYPE "InvoicePaymentKind" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "InvoicePaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'GAVE_UP', 'SKIPPED');

-- AlterEnum
ALTER TYPE "BookingSource" ADD VALUE 'IN_SHOP';
