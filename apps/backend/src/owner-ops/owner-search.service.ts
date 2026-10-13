import { Injectable } from '@nestjs/common';
import {
  QueueEntryStatus,
  type OwnerSearchHitDto,
  type OwnerSearchResultDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

const PER_GROUP = 5;

/**
 * Dashboard search, scoped by WHO is asking:
 *  - the owner (or a delegated admin) searches bookings, customers, services, the live queue and
 *    invoices of THIS shop;
 *  - a barber searches only the shop's services and the live queue (the same people the queue
 *    screen already shows them) - never the customer base, bookings or invoices.
 * Every query is salon-scoped in its WHERE clause, so a hit can never belong to another shop.
 * Navigation items (Analytics, Settings, ...) are matched on the client against the static menu.
 */
@Injectable()
export class OwnerSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async search(
    userId: string,
    salonId: string,
    rawQuery: string,
  ): Promise<OwnerSearchResultDto> {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    const kind = await this.salonAccess.getActorKind(userId, salonId);
    const q = rawQuery.trim().slice(0, 60);
    if (q.length < 2) return { query: q, hits: [] };
    const full = kind === 'OWNER' || kind === 'PLATFORM_ADMIN';
    const base = `/dashboard/salons/${salonId}`;
    const hits: OwnerSearchHitDto[] = [];
    const digits = q.replace(/\D/g, '');

    const services = await this.prisma.service.findMany({
      where: {
        salonId,
        isActive: true,
        name: { contains: q, mode: 'insensitive' },
      },
      select: { id: true, name: true, durationMinutes: true },
      take: PER_GROUP,
      orderBy: { name: 'asc' },
    });
    for (const s of services) {
      hits.push({
        type: 'service',
        id: s.id,
        title: s.name,
        subtitle: `${s.durationMinutes} min`,
        href: `${base}/services`,
      });
    }

    const queueRows = await this.prisma.queueEntry.findMany({
      where: {
        salonId,
        status: {
          in: [
            QueueEntryStatus.WAITING,
            QueueEntryStatus.CALLED,
            QueueEntryStatus.IN_SERVICE,
          ],
        },
        OR: [
          { contactName: { contains: q, mode: 'insensitive' } },
          ...(/^\d{1,4}$/.test(q) ? [{ tokenNumber: Number(q) }] : []),
        ],
      },
      select: {
        id: true,
        tokenNumber: true,
        contactName: true,
        status: true,
        assignedStaffId: true,
      },
      take: PER_GROUP,
      orderBy: { joinedAt: 'asc' },
    });
    for (const e of queueRows) {
      hits.push({
        type: 'queue',
        id: e.id,
        title: `#${e.tokenNumber}${e.contactName ? ` · ${e.contactName}` : ''}`,
        subtitle: `Live Queue · ${e.status === QueueEntryStatus.CALLED && e.assignedStaffId ? 'assigned' : e.status.replace('_', ' ').toLowerCase()}`,
        href: `${base}/queue`,
      });
    }
    if (!full) return { query: q, hits };

    const bookings = await this.prisma.booking.findMany({
      where: {
        salonId,
        OR: [
          { guestName: { contains: q, mode: 'insensitive' } },
          ...(q.length >= 6 ? [{ id: { startsWith: q.toLowerCase() } }] : []),
          ...(digits.length >= 4
            ? [
                { guestPhone: { contains: digits } },
                { customer: { phone: { contains: digits } } },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        slotStart: true,
        status: true,
        guestName: true,
        source: true,
      },
      orderBy: { slotStart: 'desc' },
      take: PER_GROUP,
    });
    for (const b of bookings) {
      hits.push({
        type: 'booking',
        id: b.id,
        title: `${b.guestName ?? 'Booking'} · ${b.id.slice(0, 8).toUpperCase()}`,
        subtitle: `${b.source === 'IN_SHOP' ? 'In-shop appointment' : 'Online booking'} · ${b.status.replace('_', ' ').toLowerCase()} · ${b.slotStart.toISOString().slice(0, 10)}`,
        href: `${base}/bookings`,
      });
    }

    const customerRows = await this.prisma.user.findMany({
      where: {
        bookings: { some: { salonId } },
        OR: [
          ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
          { email: { contains: q, mode: 'insensitive' as const } },
        ],
      },
      select: { id: true, phone: true, email: true },
      take: PER_GROUP,
    });
    for (const c of customerRows) {
      hits.push({
        type: 'customer',
        id: c.id,
        title: c.phone ?? c.email ?? 'Customer',
        subtitle: 'Customer',
        href: `${base}/customers/${c.id}`,
      });
    }

    const invoices = await this.prisma.invoice.findMany({
      where: {
        salonId,
        OR: [
          { number: { contains: q, mode: 'insensitive' } },
          { customerName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, number: true, customerName: true, status: true },
      orderBy: { issuedAt: 'desc' },
      take: PER_GROUP,
    });
    for (const i of invoices) {
      hits.push({
        type: 'invoice',
        id: i.id,
        title: i.number,
        subtitle: `Invoice${i.customerName ? ` · ${i.customerName}` : ''}${i.status === 'VOID' ? ' · void' : ''}`,
        href: `${base}/invoices?open=${i.id}`,
      });
    }
    return { query: q, hits };
  }
}
