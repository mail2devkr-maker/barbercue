import { Test } from '@nestjs/testing';
import { DashboardOverviewService } from './dashboard-overview.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DashboardOverviewService', () => {
  let service: DashboardOverviewService;
  let prisma: {
    userRole: { findMany: jest.Mock };
    salon: { findMany: jest.Mock };
    booking: { count: jest.Mock };
    queueEntry: { count: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      salon: { findMany: jest.fn().mockResolvedValue([]) },
      booking: { count: jest.fn().mockResolvedValue(0) },
      queueEntry: { count: jest.fn().mockResolvedValue(0) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardOverviewService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(DashboardOverviewService);
  });

  it('returns all zeros with no further queries when the user owns no salons', async () => {
    const result = await service.getOverview('user-with-no-shops');
    expect(result).toEqual({
      totalShops: 0,
      openShops: 0,
      todaysBookingsTotal: 0,
      activeQueueTotal: 0,
    });
    expect(prisma.booking.count).not.toHaveBeenCalled();
    expect(prisma.queueEntry.count).not.toHaveBeenCalled();
  });

  it('deduplicates a salon owned via more than one UserRole row', async () => {
    prisma.userRole.findMany.mockResolvedValueOnce([
      { salonId: 's1' },
      { salonId: 's1' },
      { salonId: 's2' },
    ]);
    const result = await service.getOverview('owner1');
    expect(result.totalShops).toBe(2);
  });

  it('counts only ACTIVE salons as open', async () => {
    prisma.userRole.findMany.mockResolvedValueOnce([
      { salonId: 's1' },
      { salonId: 's2' },
      { salonId: 's3' },
    ]);
    prisma.salon.findMany.mockResolvedValueOnce([
      { id: 's1', status: 'ACTIVE', timezone: null, city: { countryCode: 'IN' } },
      { id: 's2', status: 'ACTIVE', timezone: null, city: { countryCode: 'IN' } },
      { id: 's3', status: 'PENDING', timezone: null, city: { countryCode: 'IN' } },
    ]);
    const result = await service.getOverview('owner1');
    expect(result.openShops).toBe(2);
  });

  it('scopes today\'s-bookings to each owned salon\'s OWN local calendar day, not one shared window', async () => {
    prisma.userRole.findMany.mockResolvedValueOnce([{ salonId: 's1' }, { salonId: 's2' }]);
    // Two different timezones — this is exactly why a single global slotStart range would be
    // wrong: "today" is a different UTC window for each of these two owned shops.
    prisma.salon.findMany.mockResolvedValueOnce([
      { id: 's1', status: 'ACTIVE', timezone: null, city: { countryCode: 'IN' } },
      { id: 's2', status: 'ACTIVE', timezone: 'Europe/London', city: { countryCode: 'GB' } },
    ]);
    prisma.booking.count.mockResolvedValueOnce(7);
    prisma.queueEntry.count.mockResolvedValueOnce(3);

    const result = await service.getOverview('owner1');

    expect(result.todaysBookingsTotal).toBe(7);
    expect(result.activeQueueTotal).toBe(3);
    const bookingArgs = prisma.booking.count.mock.calls[0][0] as {
      where: { OR: { salonId: string; slotStart: { gte: Date; lt: Date } }[] };
    };
    const salonIds = bookingArgs.where.OR.map((clause) => clause.salonId).sort();
    expect(salonIds).toEqual(['s1', 's2']);
    // Each clause carries its own start/end — not a single window reused for both salons.
    const [s1Clause, s2Clause] = bookingArgs.where.OR;
    expect(s1Clause.slotStart.gte.getTime()).not.toBe(s2Clause.slotStart.gte.getTime());
  });

  it('reports todaysBookingsTotal as null — never a silently partial number — when any owned salon has no trustworthy timezone', async () => {
    prisma.userRole.findMany.mockResolvedValueOnce([{ salonId: 's1' }, { salonId: 's2' }]);
    prisma.salon.findMany.mockResolvedValueOnce([
      { id: 's1', status: 'ACTIVE', timezone: null, city: { countryCode: 'IN' } },
      // Unresolvable: no explicit timezone, and a non-India country never falls back.
      { id: 's2', status: 'ACTIVE', timezone: null, city: { countryCode: 'US' } },
    ]);

    const result = await service.getOverview('owner1');

    expect(result.todaysBookingsTotal).toBeNull();
    expect(prisma.booking.count).not.toHaveBeenCalled();
  });
});
