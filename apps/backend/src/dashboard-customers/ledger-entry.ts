import type { Prisma } from '@prisma/client';
import { summarizeServiceNames, type CustomerLedgerEntryDto, type LedgerReason, type LedgerStatus } from '@barbercue/shared';
import { resolveEffectiveBookingServices } from '../bookings/effective-booking-services';

// Shared by dashboard-customers.service.ts (buildSummaries, getOwnedLedgerEntry, the post-mutation
// re-read in waiveNoShowDue/restoreNoShowDue) and cancellation-courtesy-waiver.service.ts (waive,
// restore, getOwnedCancellationEntry) so the mapping from a raw CustomerLedgerEntry row to
// CustomerLedgerEntryDto can never drift between the two call sites — this file used to be
// duplicated verbatim in both (P1 production-safety hardening: deduplicated here while fixing the
// bug below).
export interface LedgerRow {
  id: string;
  customerId: string;
  salonId: string;
  bookingId: string | null;
  amount: { toString(): string } | number;
  reason: string;
  status: string;
  createdAt: Date;
  settledAt: Date | null;
  booking: {
    slotStart: Date;
    serviceId: string;
    service: { name: string; durationMinutes: number; price: Prisma.Decimal };
    services: readonly {
      serviceId: string;
      serviceName: string;
      durationMinutes: number;
      price: Prisma.Decimal;
    }[];
  } | null;
}

export const ledgerRowSelect = {
  id: true,
  customerId: true,
  salonId: true,
  bookingId: true,
  amount: true,
  reason: true,
  status: true,
  createdAt: true,
  settledAt: true,
  booking: {
    select: {
      slotStart: true,
      serviceId: true,
      service: { select: { name: true, durationMinutes: true, price: true } },
      // Multi-service booking core mission (P1 follow-up) — bookingServiceName below must be a
      // truthful summary of the COMPLETE selection, not silently just the primary service.
      services: { select: { serviceId: true, serviceName: true, durationMinutes: true, price: true } },
    },
  },
} as const;

export function toLedgerEntryDto(row: LedgerRow): CustomerLedgerEntryDto {
  return {
    id: row.id,
    customerId: row.customerId,
    salonId: row.salonId,
    bookingId: row.bookingId,
    amount: Number(row.amount),
    reason: row.reason as LedgerReason,
    status: row.status as LedgerStatus,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    // Multi-service booking core mission (P1 follow-up) — a concise, truthful summary ("Haircut +
    // Beard Trim", or "3 services") across every service the charged booking actually had, not
    // silently just the primary one. Falls back to the live Service join
    // (resolveEffectiveBookingServices) for a rolling-deploy booking with zero BookingService rows.
    bookingServiceName: row.booking
      ? summarizeServiceNames(
          resolveEffectiveBookingServices(row.booking).map((s) => s.serviceName),
        )
      : null,
    bookingSlotStart: row.booking?.slotStart.toISOString() ?? null,
  };
}
