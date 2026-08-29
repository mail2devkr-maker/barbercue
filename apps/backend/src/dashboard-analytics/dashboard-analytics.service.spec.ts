import { Test } from '@nestjs/testing';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

function decimal(value: string) {
  return { toString: () => value } as unknown as number;
}

describe('DashboardAnalyticsService', () => {
  let service: DashboardAnalyticsService;
  let prisma: {
    salon: { findUnique: jest.Mock };
    booking: { groupBy: jest.Mock; findMany: jest.Mock };
    queueEntry: { count: jest.Mock; findMany: jest.Mock };
    serviceSession: { findMany: jest.Mock };
  };
  let salonAccess: { assertAccess: jest.Mock<Promise<void>, [string, string]> };

  beforeEach(async () => {
    prisma = {
      salon: {
        findUnique: jest.fn().mockResolvedValue({ currency: 'INR' }),
      },
      booking: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      queueEntry: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      serviceSession: { findMany: jest.fn().mockResolvedValue([]) },
    };
    salonAccess = {
      assertAccess: jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardAnalyticsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalonAccessService, useValue: salonAccess },
      ],
    }).compile();
    service = moduleRef.get(DashboardAnalyticsService);
  });

  it('checks salon access before reading anything', async () => {
    await service.getAnalytics('owner1', 's1', 'today', undefined, undefined);
    expect(salonAccess.assertAccess).toHaveBeenCalledWith('owner1', 's1');
  });

  it('rejects an owner who does not operate this salon', async () => {
    salonAccess.assertAccess.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
    );
    await expect(
      service.getAnalytics('owner-b', 's1', 'today', undefined, undefined),
    ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    expect(prisma.booking.groupBy).not.toHaveBeenCalled();
  });

  it('defaults to "today" for an unrecognized/missing range value', async () => {
    await service.getAnalytics('owner1', 's1', undefined, undefined, undefined);
    const call = prisma.booking.groupBy.mock.calls[0][0] as {
      where: { slotStart: { gte: Date; lt: Date } };
    };
    const spanHours =
      (call.where.slotStart.lt.getTime() - call.where.slotStart.gte.getTime()) / (60 * 60_000);
    expect(spanHours).toBe(24);
  });

  it('spans 7 days for range=7d', async () => {
    await service.getAnalytics('owner1', 's1', '7d', undefined, undefined);
    const call = prisma.booking.groupBy.mock.calls[0][0] as {
      where: { slotStart: { gte: Date; lt: Date } };
    };
    const spanDays =
      (call.where.slotStart.lt.getTime() - call.where.slotStart.gte.getTime()) / (24 * 60 * 60_000);
    expect(spanDays).toBe(7);
  });

  it('rejects an invalid custom range (from after to)', async () => {
    await expect(
      service.getAnalytics(
        'owner1',
        's1',
        'custom',
        '2026-06-10T00:00:00.000Z',
        '2026-06-01T00:00:00.000Z',
      ),
    ).rejects.toThrow();
  });

  it('accepts a valid custom range', async () => {
    const result = await service.getAnalytics(
      'owner1',
      's1',
      'custom',
      '2026-06-01T00:00:00.000Z',
      '2026-06-10T00:00:00.000Z',
    );
    expect(result.from).toBe('2026-06-01T00:00:00.000Z');
    expect(result.to).toBe('2026-06-10T00:00:00.000Z');
  });

  it('maps booking status groupBy counts to completed/cancelled/no-show', async () => {
    prisma.booking.groupBy.mockResolvedValueOnce([
      { status: 'COMPLETED', _count: { _all: 4 } },
      { status: 'CANCELLED', _count: { _all: 2 } },
      { status: 'NO_SHOW', _count: { _all: 1 } },
    ]);
    const result = await service.getAnalytics('owner1', 's1', 'today', undefined, undefined);
    expect(result.completedCount).toBe(4);
    expect(result.cancelledCount).toBe(2);
    expect(result.noShowCount).toBe(1);
  });

  it('sums estimated service value from completed bookings\' service prices', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([
      { customerId: 'c1', serviceId: 'sv1', service: { name: 'Haircut', price: decimal('300') } },
      { customerId: 'c2', serviceId: 'sv1', service: { name: 'Haircut', price: decimal('300') } },
    ]);
    const result = await service.getAnalytics('owner1', 's1', 'today', undefined, undefined);
    expect(result.estimatedServiceValue).toBe(600);
  });

  it('ranks service popularity by completed-booking count, descending', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([
      { customerId: 'c1', serviceId: 'sv1', service: { name: 'Haircut', price: decimal('300') } },
      { customerId: 'c2', serviceId: 'sv1', service: { name: 'Haircut', price: decimal('300') } },
      { customerId: 'c3', serviceId: 'sv2', service: { name: 'Shave', price: decimal('150') } },
    ]);
    const result = await service.getAnalytics('owner1', 's1', 'today', undefined, undefined);
    expect(result.servicePopularity).toEqual([
      { serviceId: 'sv1', name: 'Haircut', completedCount: 2 },
      { serviceId: 'sv2', name: 'Shave', completedCount: 1 },
    ]);
  });

  it('classifies a customer with no prior completed visit as new, and one with a prior visit as repeat', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([
      { customerId: 'first-timer', serviceId: 'sv1', service: { name: 'Haircut', price: decimal('300') } },
      { customerId: 'regular', serviceId: 'sv1', service: { name: 'Haircut', price: decimal('300') } },
    ]);
    prisma.booking.groupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by.includes('customerId')) {
        // The "prior visitor" lookup — only "regular" has an earlier completed booking.
        return Promise.resolve([{ customerId: 'regular', _count: { _all: 1 } }]);
      }
      return Promise.resolve([]); // status groupBy
    });
    const result = await service.getAnalytics('owner1', 's1', 'today', undefined, undefined);
    expect(result.newCustomerCount).toBe(1);
    expect(result.repeatCustomerCount).toBe(1);
  });

  it('computes averageWaitMinutes only from entries that were actually called', async () => {
    const joinedAt = new Date('2026-06-01T10:00:00.000Z');
    prisma.queueEntry.findMany.mockResolvedValueOnce([
      { joinedAt, calledAt: new Date(joinedAt.getTime() + 10 * 60_000) },
      { joinedAt, calledAt: new Date(joinedAt.getTime() + 20 * 60_000) },
    ]);
    const result = await service.getAnalytics('owner1', 's1', 'today', undefined, undefined);
    expect(result.averageWaitMinutes).toBe(15);
  });

  it('returns null averageWaitMinutes when there are no called entries', async () => {
    const result = await service.getAnalytics('owner1', 's1', 'today', undefined, undefined);
    expect(result.averageWaitMinutes).toBeNull();
  });

  it('computes barber and chair utilization from completed service sessions', async () => {
    const start = new Date('2026-06-01T10:00:00.000Z');
    prisma.serviceSession.findMany.mockResolvedValueOnce([
      {
        staffId: 'st1',
        chairId: 'ch1',
        startedAt: start,
        endedAt: new Date(start.getTime() + 30 * 60_000),
        staff: { displayName: 'Marcus' },
        chair: { label: 'Chair 1' },
      },
      {
        staffId: 'st1',
        chairId: 'ch1',
        startedAt: start,
        endedAt: new Date(start.getTime() + 20 * 60_000),
        staff: { displayName: 'Marcus' },
        chair: { label: 'Chair 1' },
      },
    ]);
    const result = await service.getAnalytics('owner1', 's1', 'today', undefined, undefined);
    expect(result.barberUtilization).toEqual([
      { id: 'st1', displayName: 'Marcus', completedSessions: 2, totalServiceMinutes: 50 },
    ]);
    expect(result.chairUtilization).toEqual([
      { id: 'ch1', displayName: 'Chair 1', completedSessions: 2, totalServiceMinutes: 50 },
    ]);
    expect(result.averageServiceDurationMinutes).toBe(25);
  });

  it('buckets bookings into peak/slow hours by IST hour-of-day', async () => {
    // 09:00 IST = 03:30 UTC, 14:00 IST = 08:30 UTC
    prisma.booking.findMany.mockImplementation((args: { select?: { slotStart?: boolean } }) => {
      if (args.select?.slotStart) {
        return Promise.resolve([
          { slotStart: new Date('2026-06-01T03:30:00.000Z') },
          { slotStart: new Date('2026-06-01T03:45:00.000Z') },
          { slotStart: new Date('2026-06-01T08:30:00.000Z') },
        ]);
      }
      return Promise.resolve([]); // completed-bookings query
    });
    const result = await service.getAnalytics('owner1', 's1', 'today', undefined, undefined);
    expect(result.peakHours[0]).toEqual({ hour: 9, count: 2 });
    expect(result.slowHours.some((h) => h.hour === 14 && h.count === 1)).toBe(true);
  });
});
