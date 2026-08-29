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
      { status: 'ACTIVE' },
      { status: 'ACTIVE' },
      { status: 'PENDING' },
    ]);
    const result = await service.getOverview('owner1');
    expect(result.openShops).toBe(2);
  });

  it('scopes booking/queue aggregates to exactly the owned salon ids', async () => {
    prisma.userRole.findMany.mockResolvedValueOnce([{ salonId: 's1' }, { salonId: 's2' }]);
    prisma.booking.count.mockResolvedValueOnce(7);
    prisma.queueEntry.count.mockResolvedValueOnce(3);

    const result = await service.getOverview('owner1');

    expect(result.todaysBookingsTotal).toBe(7);
    expect(result.activeQueueTotal).toBe(3);
    const bookingArgs = prisma.booking.count.mock.calls[0][0] as {
      where: { salonId: { in: string[] } };
    };
    expect(bookingArgs.where.salonId.in.sort()).toEqual(['s1', 's2']);
  });
});
