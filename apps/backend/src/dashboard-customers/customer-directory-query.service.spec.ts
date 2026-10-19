import {
  BookingErrorCode,
  ownerCustomerDirectoryQuerySchema,
  ownerCustomerServicesQuerySchema,
} from '@barbercue/shared';
import { CustomerDirectoryQueryService } from './customer-directory-query.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

describe('CustomerDirectoryQueryService', () => {
  const previousSecret = process.env.JWT_ACCESS_SECRET;
  let service: CustomerDirectoryQueryService;
  let prisma: {
    $queryRaw: jest.Mock;
    salon: { findUnique: jest.Mock };
    booking: { count: jest.Mock };
    queueEntry: { count: jest.Mock };
  };
  let access: { assertOwnerOrAdminAccess: jest.Mock };

  const row = (overrides: Record<string, unknown> = {}) => ({
    customerId: 'customer-1',
    phone: '+91 99999 11111',
    email: 'customer@example.test',
    totalBookings: 4n,
    completedBookings: 2n,
    cancelledBookings: 1n,
    noShowBookings: 1n,
    totalQueueVisits: 2n,
    completedQueueVisits: 2n,
    cancelledQueueVisits: 0n,
    expiredQueueVisits: 0n,
    noShowQueueVisits: 0n,
    firstCompletedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastVisitAt: new Date('2026-03-01T00:00:00.000Z'),
    collectedPaise: 42500n,
    refundedPaise: 2500n,
    netSpentPaise: 40000n,
    segment: 'repeat',
    ...overrides,
  });

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET ??=
      'customer-directory-test-secret-32-characters-long';
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = previousSecret;
  });

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      salon: { findUnique: jest.fn().mockResolvedValue({ currency: 'INR' }) },
      booking: { count: jest.fn().mockResolvedValue(0) },
      queueEntry: { count: jest.fn().mockResolvedValue(0) },
    };
    access = { assertOwnerOrAdminAccess: jest.fn().mockResolvedValue('OWNER') };
    service = new CustomerDirectoryQueryService(
      prisma as unknown as PrismaService,
      access as unknown as SalonAccessService,
    );
  });

  it('returns exact shop-scoped collected/refunded totals and deduplicated completed-visit metrics', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([row()]);
    const result = await service.directory(
      'owner-1',
      'salon-1',
      ownerCustomerDirectoryQuerySchema.parse({}),
    );

    expect(access.assertOwnerOrAdminAccess).toHaveBeenCalledWith(
      'owner-1',
      'salon-1',
    );
    expect(result).toMatchObject({
      salonId: 'salon-1',
      currency: 'INR',
      items: [
        {
          customerId: 'customer-1',
          displayName: null,
          displayNameSource: 'NOT_ON_FILE',
          totalBookings: 4,
          completedCount: 2,
          totalVisitCount: 6,
          completedVisitCount: 4,
          repeatVisitCount: 3,
          recordedCollections: 425,
          recordedRefunds: 25,
          totalSpent: 400,
          segment: 'repeat',
        },
      ],
      nextCursor: null,
    });

    const sql = prisma.$queryRaw.mock.calls[0][0].sql as string;
    expect(sql).toContain('q."bookingId" IS NULL');
    expect(sql).toContain('ip."kind" = \'PAYMENT\'');
    expect(sql).toContain('ip."kind" = \'REFUND\'');
    expect(sql).toContain('i."salonId" =');
    expect(sql).toContain('u."deletedAt" IS NULL');
  });

  it('uses deterministic keyset ordering and binds a cursor to actor, salon, and filters', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        row({
          customerId: 'customer-a',
          lastVisitAt: new Date('2026-03-02T00:00:00.000Z'),
        }),
        row({
          customerId: 'customer-b',
          lastVisitAt: new Date('2026-03-01T00:00:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([
        row({
          customerId: 'customer-b',
          lastVisitAt: new Date('2026-03-01T00:00:00.000Z'),
        }),
      ]);

    const query = ownerCustomerDirectoryQuerySchema.parse({
      limit: 1,
      sort: 'lastVisit',
      q: '  haircut ',
    });
    const first = await service.directory('owner-1', 'salon-1', query);
    expect(first.items[0].customerId).toBe('customer-a');
    expect(first.nextCursor).toBeTruthy();

    const second = await service.directory('owner-1', 'salon-1', {
      ...query,
      cursor: first.nextCursor!,
    });
    expect(second.items[0].customerId).toBe('customer-b');
    const secondSql = prisma.$queryRaw.mock.calls[1][0].sql as string;
    expect(secondSql).toContain('m."lastVisitAt" <');
    expect(secondSql).toContain('m."customerId" >');
    expect(secondSql).toContain(
      'ORDER BY m."lastVisitAt" DESC NULLS LAST, m."customerId" ASC',
    );

    await expect(
      service.directory('owner-2', 'salon-1', {
        ...query,
        cursor: first.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.INVALID_FILTER });
    await expect(
      service.directory('owner-1', 'salon-2', {
        ...query,
        cursor: first.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.INVALID_FILTER });
    await expect(
      service.directory('owner-1', 'salon-1', {
        ...query,
        q: 'another search',
        cursor: first.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.INVALID_FILTER });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('applies validated segmentation, minimum completed visits, search, and sort on the server', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([row()]);
    await service.directory(
      'owner-1',
      'salon-1',
      ownerCustomerDirectoryQuerySchema.parse({
        q: '998877',
        segment: 'frequent',
        sort: 'totalSpent',
        minVisits: 5,
      }),
    );
    const sql = prisma.$queryRaw.mock.calls[0][0].sql as string;
    const values = prisma.$queryRaw.mock.calls[0][0].values as unknown[];
    expect(sql).toContain('REGEXP_REPLACE');
    expect(sql).toContain('m."segment" =');
    expect(sql).toContain('m."netSpentPaise" DESC, m."customerId" ASC');
    expect(values).toContain('frequent');
    expect(values).toContain(5);
    expect(values).toContain('998877');
  });

  it('rejects a tampered cursor and fails closed when signing configuration is missing', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      row(),
      row({ customerId: 'customer-2' }),
    ]);
    const query = ownerCustomerDirectoryQuerySchema.parse({ limit: 1 });
    const first = await service.directory('owner-1', 'salon-1', query);
    const [payload, signature] = first.nextCursor!.split('.');
    const tampered = `${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
    await expect(
      service.directory('owner-1', 'salon-1', { ...query, cursor: tampered }),
    ).rejects.toMatchObject({ code: BookingErrorCode.INVALID_FILTER });

    const configured = process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_ACCESS_SECRET;
    prisma.$queryRaw.mockResolvedValueOnce([
      row(),
      row({ customerId: 'customer-2' }),
    ]);
    try {
      await expect(
        service.directory('owner-1', 'salon-1', query),
      ).rejects.toMatchObject({
        code: BookingErrorCode.CUSTOMER_DIRECTORY_CURSOR_UNAVAILABLE,
        status: 503,
      });
    } finally {
      if (configured === undefined) delete process.env.JWT_ACCESS_SECRET;
      else process.env.JWT_ACCESS_SECRET = configured;
    }
  });

  it('checks salon authorization before directory queries', async () => {
    access.assertOwnerOrAdminAccess.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
    );
    await expect(
      service.directory(
        'owner-b',
        'salon-1',
        ownerCustomerDirectoryQuerySchema.parse({}),
      ),
    ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns per-service rows without duplicating booking-linked queue visits and labels invoice amounts honestly', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        visitId: 'booking-1',
        bookingId: 'booking-1',
        source: 'ONLINE_BOOKING',
        sourceRank: 0,
        serviceId: 'service-1',
        serviceName: 'Haircut',
        staffName: 'Ravi',
        eventAt: new Date('2026-10-01T10:30:00.000Z'),
        completedAt: new Date('2026-10-01T10:30:00.000Z'),
        serviceOrder: 0,
        invoicedAmount: '125.00',
      },
      {
        visitId: 'queue-1',
        bookingId: null,
        source: 'LIVE_QUEUE',
        sourceRank: 2,
        serviceId: 'service-2',
        serviceName: 'Beard Trim',
        staffName: 'Amit',
        eventAt: new Date('2026-10-01T09:30:00.000Z'),
        completedAt: null,
        serviceOrder: 0,
        invoicedAmount: null,
      },
    ]);
    const result = await service.services(
      'owner-1',
      'salon-1',
      'customer-1',
      ownerCustomerServicesQuerySchema.parse({ limit: 1 }),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        visitId: 'booking-1',
        source: 'ONLINE_BOOKING',
        serviceName: 'Haircut',
        amount: 125,
        amountKind: 'INVOICED',
        currency: 'INR',
      }),
    ]);
    expect(result.nextCursor).toBeTruthy();
    const sql = prisma.$queryRaw.mock.calls[0][0].sql as string;
    expect(sql).toContain('q."bookingId" IS NULL');
    expect(sql).toContain('i."status" = \'ISSUED\'');
  });

  it('rejects customer service cursors replayed across actors or customers', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        visitId: 'booking-1',
        bookingId: 'booking-1',
        source: 'ONLINE_BOOKING',
        sourceRank: 0,
        serviceId: 'service-1',
        serviceName: 'Haircut',
        staffName: null,
        eventAt: new Date('2026-10-01T10:30:00.000Z'),
        completedAt: null,
        serviceOrder: 0,
        invoicedAmount: null,
      },
      {
        visitId: 'booking-2',
        bookingId: 'booking-2',
        source: 'ONLINE_BOOKING',
        sourceRank: 0,
        serviceId: 'service-2',
        serviceName: 'Trim',
        staffName: null,
        eventAt: new Date('2026-10-01T09:30:00.000Z'),
        completedAt: null,
        serviceOrder: 0,
        invoicedAmount: null,
      },
    ]);
    const query = ownerCustomerServicesQuerySchema.parse({ limit: 1 });
    const first = await service.services(
      'owner-1',
      'salon-1',
      'customer-1',
      query,
    );
    await expect(
      service.services('owner-2', 'salon-1', 'customer-1', {
        ...query,
        cursor: first.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.INVALID_FILTER });
    await expect(
      service.services('owner-1', 'salon-1', 'customer-2', {
        ...query,
        cursor: first.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: BookingErrorCode.INVALID_FILTER });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
