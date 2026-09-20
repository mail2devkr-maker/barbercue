import { Prisma } from '@prisma/client';

/**
 * Serialises the transactions that resolve a booking's arrival decision - "Arrived" (creates the
 * QueueEntry) and "No Show" (terminalises the booking) - for ONE booking.
 *
 * Why it exists: the mandatory arrival alert can now reach more than one person (the owner and the
 * booking's assigned staff member), and either can answer at the same moment - or race a customer's own
 * check-in. Both operations decide from "is there a queue entry / is it still CONFIRMED", and a plain
 * read-then-write cannot see the other transaction's uncommitted work. A per-booking Postgres advisory
 * transaction lock makes them run one after the other; whoever goes second re-reads committed state
 * under the lock and is rejected as already resolved (409), so a booking can never be both checked in
 * and marked no-show, and can never transition twice. Same lock idiom as the per-salon locks in
 * bookings.service.ts / queue.service.ts (`$executeRaw`, because pg_advisory_xact_lock returns void).
 */
export async function lockBookingResolution(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`booking-resolution:${bookingId}`}))`,
  );
}
