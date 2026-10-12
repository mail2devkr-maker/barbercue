import { VisitHistoryService } from './visit-history.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

function queueRow(id: string, status: string, day: number) {
  return {
    id,
    salonId: 'salon-1',
    customerId: `customer-${id}`,
    bookingId: null,
    source: 'WALK_IN',
    status,
    joinedAt: new Date(`2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`),
    serviceStartedAt:
      status === 'COMPLETED'
        ? new Date(`2026-10-${String(day).padStart(2, '0')}T08:20:00.000Z`)
        : null,
    serviceCompletedAt:
      status === 'COMPLETED'
        ? new Date(`2026-10-${String(day).padStart(2, '0')}T08:45:00.000Z`)
        : null,
    createdAt: new Date(
      `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`,
    ),
    contactName: null,
    contactPhone: null,
    service: { id: 'service-1', name: 'Haircut' },
    assignedStaff: null,
    serviceSessions: [],
    reviews: [],
    customer: null,
    salon: {
      id: 'salon-1',
      name: 'Handsome Center',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      city: { countryCode: 'IN' },
    },
  };
}

function bookingRow(id: string, slotStart: string) {
  return {
    id,
    salonId: 'salon-1',
    customerId: `customer-${id}`,
    serviceId: 'service-1',
    status: 'COMPLETED',
    slotStart: new Date(slotStart),
    slotEnd: new Date(new Date(slotStart).getTime() + 30 * 60_000),
    createdAt: new Date('2026-10-01T08:00:00.000Z'),
    source: 'WEB',
    salon: {
      name: 'Handsome Center',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      city: { countryCode: 'IN' },
    },
    service: { id: 'service-1', name: 'Haircut', price: 100 },
    services: [],
    preferredStaff: null,
    queueEntries: [],
    reviews: [],
    customer: { phone: null, email: null },
  };
}

describe('VisitHistoryService', () => {
  const prisma = {
    booking: { findMany: jest.fn() },
    queueEntry: { findMany: jest.fn() },
    salon: { findUnique: jest.fn() },
  } as unknown as PrismaService;
  const salonAccess = {
    assertOwnerOrAdminAccess: jest.fn(),
  } as unknown as SalonAccessService;
  const service = new VisitHistoryService(prisma, salonAccess);

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.queueEntry.findMany as jest.Mock).mockResolvedValue([]);
    (salonAccess.assertOwnerOrAdminAccess as jest.Mock).mockResolvedValue(
      'SALON_OWNER',
    );
  });

  it('projects the verified Handsome Center history cohort without rewriting EXPIRED outcomes', async () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, index) =>
        queueRow(`complete-${index}`, 'COMPLETED', 11),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        queueRow(`expired-${index}`, 'EXPIRED', 11),
      ),
    ];
    (prisma.queueEntry.findMany as jest.Mock).mockResolvedValue(rows);

    const result = await service.listOwner(
      'owner-1',
      'salon-1',
      'all',
      'LIVE_QUEUE',
    );

    expect(result.items).toHaveLength(11);
    expect(
      result.items.filter((item) => item.status === 'COMPLETED'),
    ).toHaveLength(8);
    expect(
      result.items.filter((item) => item.status === 'EXPIRED'),
    ).toHaveLength(3);
    expect(result.items.every((item) => item.source === 'LIVE_QUEUE')).toBe(
      true,
    );
    expect(result.items.every((item) => item.price === null)).toBe(true);
    expect(prisma.queueEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          salonId: 'salon-1',
          bookingId: null,
          source: 'WALK_IN',
        }),
      }),
    );
    expect(salonAccess.assertOwnerOrAdminAccess).toHaveBeenCalledWith(
      'owner-1',
      'salon-1',
    );
  });

  it('scopes customer queue history to the authenticated account and returns no owner contact fields', async () => {
    (prisma.queueEntry.findMany as jest.Mock).mockResolvedValue([
      queueRow('mine', 'COMPLETED', 11),
    ]);
    const result = await service.listCustomer('customer-mine', 'LIVE_QUEUE');
    const query = (prisma.queueEntry.findMany as jest.Mock).mock.calls[0][0];

    expect(query.where).toEqual(
      expect.objectContaining({ customerId: 'customer-mine', bookingId: null }),
    );
    expect(result.items[0]).toMatchObject({
      source: 'LIVE_QUEUE',
      status: 'COMPLETED',
      reviewEligible: true,
    });
    expect(result.items[0]).not.toHaveProperty('customerPhone');
    expect(result.items[0]).not.toHaveProperty('customerEmail');
    expect(query.include).not.toHaveProperty('customer');
  });

  it('does not expose a review attached to a different customer even if history rows are inconsistent', async () => {
    const row = {
      ...queueRow('mine', 'COMPLETED', 11),
      reviews: [
        {
          id: 'foreign-review',
          customerId: 'someone-else',
          rating: 1,
          comment: 'private',
          ownerResponse: null,
          bookingId: null,
          queueEntryId: 'mine',
          salonId: 'salon-1',
          createdAt: new Date('2026-10-11T10:00:00.000Z'),
          updatedAt: new Date('2026-10-11T10:00:00.000Z'),
        },
      ],
    };
    (prisma.queueEntry.findMany as jest.Mock).mockResolvedValue([row]);

    const result = await service.listCustomer('customer-mine', 'LIVE_QUEUE');

    expect(result.items[0].myReview).toBeNull();
    expect(result.items[0].reviewEligible).toBe(false);
  });

  it('does not include appointment-linked queue rows in the standalone queue stream', async () => {
    await service.listCustomer('customer-1', 'LIVE_QUEUE');
    const query = (prisma.queueEntry.findMany as jest.Mock).mock.calls[0][0];
    expect(query.where).toEqual(expect.objectContaining({ bookingId: null }));
  });

  it('merges owner booking and standalone queue records once with stable global pagination', async () => {
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([
      bookingRow('booking-1', '2026-10-11T10:00:00.000Z'),
    ]);
    (prisma.queueEntry.findMany as jest.Mock).mockResolvedValue([
      queueRow('queue-1', 'COMPLETED', 12),
    ]);

    const result = await service.listOwner(
      'owner-1',
      'salon-1',
      'all',
      'all',
      undefined,
      '1',
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      source: 'LIVE_QUEUE',
      queueEntryId: 'queue-1',
    });
    expect(result.nextCursor).toBeTruthy();
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 }),
    );
    expect(prisma.queueEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        where: expect.objectContaining({ bookingId: null }),
      }),
    );
  });

  it('does not issue either history read when salon authorization fails', async () => {
    (salonAccess.assertOwnerOrAdminAccess as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
    );
    await expect(service.listOwner('owner-b', 'salon-a')).rejects.toMatchObject(
      {
        code: 'SALON_ACCESS_DENIED',
      },
    );
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
    expect(prisma.queueEntry.findMany).not.toHaveBeenCalled();
  });

  it('bounds merged history reads with deterministic keyset ordering and rejects malformed cursors', async () => {
    await service.listCustomer('customer-1', 'all', undefined, '10');
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ slotStart: 'desc' }, { id: 'desc' }],
        take: 11,
      }),
    );
    expect(prisma.queueEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
        take: 11,
      }),
    );
    await expect(
      service.listCustomer('customer-1', 'all', 'not-a-cursor'),
    ).rejects.toMatchObject({
      code: 'INVALID_FILTER',
    });
  });

  it('uses salon-local day bounds for today and only future online appointments for upcoming', async () => {
    (prisma.salon.findUnique as jest.Mock).mockResolvedValue({
      timezone: 'Asia/Kolkata',
      city: { countryCode: 'IN' },
    });
    await service.listOwner('owner-1', 'salon-1', 'today', 'LIVE_QUEUE');
    const todayQuery = (prisma.queueEntry.findMany as jest.Mock).mock
      .calls[0][0];
    expect(todayQuery.where.AND[0].joinedAt).toHaveProperty('gte');
    expect(todayQuery.where.AND[0].joinedAt).toHaveProperty('lt');

    jest.clearAllMocks();
    (prisma.salon.findUnique as jest.Mock).mockResolvedValue({
      timezone: 'Asia/Kolkata',
      city: { countryCode: 'IN' },
    });
    await service.listOwner('owner-1', 'salon-1', 'upcoming', 'ONLINE_BOOKING');
    const upcomingQuery = (prisma.booking.findMany as jest.Mock).mock
      .calls[0][0];
    expect(upcomingQuery.where.status.in).toEqual([
      'CONFIRMED',
      'PENDING_PAYMENT',
    ]);
    expect(upcomingQuery.where.AND[0].slotStart).toHaveProperty('gte');
  });
});
