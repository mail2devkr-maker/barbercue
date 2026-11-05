import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingStatus,
  type AdminBookingRowDto,
  type AdminBookingsPageDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { localRange } from '../owner-ops/local-time';
import { addZonedCalendarDays } from '../common/timezone/timezone';

export const ADMIN_BOOKINGS_PAGE_SIZE = 50;
const TIME_ZONE = 'Asia/Kolkata';

export interface AdminBookingsQuery {
  cursor?: string;
  status?: BookingStatus;
  /** Inclusive IST calendar days on the appointment time, YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Shop name or BC-SHOP id. */
  shop?: string;
}

/**
 * "All Bookings" for the admin dashboard: every shop's bookings, newest appointment first, cursor
 * paged. Privacy-safe by construction - the select never reads the customer, guest name/phone, internal
 * note or cancellation reason; a shop's own Bookings page (delegated access) has the details.
 */
@Injectable()
export class AdminBookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: AdminBookingsQuery): Promise<AdminBookingsPageDto> {
    const cursor = decodeCursor(q.cursor);
    const slot: Prisma.DateTimeFilter = {};
    // Whole IST days: [from 00:00, day-after-to 00:00).
    if (q.from) {
      const r = localRange(q.from, addZonedCalendarDays(q.from, 1), TIME_ZONE);
      if (r) slot.gte = r.start;
    }
    if (q.to) {
      const r = localRange(q.to, addZonedCalendarDays(q.to, 1), TIME_ZONE);
      if (r) slot.lt = r.end;
    }
    const shop = q.shop?.trim();
    const where: Prisma.BookingWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to ? { slotStart: slot } : {}),
      ...(shop
        ? {
            salon: {
              OR: [
                { name: { contains: shop, mode: 'insensitive' } },
                { publicId: { equals: shop.toUpperCase() } },
              ],
            },
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { slotStart: { lt: cursor.at } },
              { slotStart: cursor.at, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.booking.findMany({
      where,
      orderBy: [{ slotStart: 'desc' }, { id: 'desc' }],
      take: ADMIN_BOOKINGS_PAGE_SIZE + 1,
      select: {
        id: true,
        slotStart: true,
        slotEnd: true,
        status: true,
        source: true,
        createdAt: true,
        customerId: true,
        cancelledByActor: true,
        offerTitle: true,
        salon: { select: { id: true, name: true, publicId: true } },
        service: { select: { name: true } },
      },
    });
    const page = rows.slice(0, ADMIN_BOOKINGS_PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      items: page.map((b): AdminBookingRowDto => ({
        id: b.id,
        shop: b.salon,
        serviceName: b.service.name,
        slotStart: b.slotStart.toISOString(),
        slotEnd: b.slotEnd.toISOString(),
        status: b.status as BookingStatus,
        source: b.source,
        createdAt: b.createdAt.toISOString(),
        guest: !b.customerId,
        cancelledBy: b.cancelledByActor ?? null,
        offerTitle: b.offerTitle ?? null,
      })),
      nextCursor:
        rows.length > ADMIN_BOOKINGS_PAGE_SIZE && last
          ? encodeCursor(last.slotStart, last.id)
          : null,
    };
  }
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}\n${id}`).toString('base64url');
}

function decodeCursor(value?: string): { at: Date; id: string } | undefined {
  if (!value) return undefined;
  const [ts, id, ...extra] = Buffer.from(value, 'base64url')
    .toString('utf8')
    .split('\n');
  const at = new Date(ts ?? '');
  if (
    extra.length ||
    !id ||
    Number.isNaN(at.getTime()) ||
    at.toISOString() !== ts
  )
    throw new AppException(
      'INVALID_CURSOR',
      'The page cursor is invalid. Refresh and try again.',
      HttpStatus.BAD_REQUEST,
    );
  return { at, id };
}
