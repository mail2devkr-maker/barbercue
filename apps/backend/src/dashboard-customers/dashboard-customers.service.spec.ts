import { Test } from '@nestjs/testing';
import {
  DashboardCustomersService,
  FREQUENT_CUSTOMER_THRESHOLD,
} from './dashboard-customers.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

interface BookingGroupByArgs {
  by: string[];
  where: { status?: string; customerId?: { in: string[] } };
  skip?: number;
}

interface QueueGroupByArgs {
  by: string[];
}

// A configurable fake for booking.groupBy — real tests set `data` per (by-shape, status) key
// rather than relying on call-order, since buildSummaries fires several groupBy calls in
// parallel via Promise.all and the exact order is an implementation detail tests shouldn't pin.
function makeBookingGroupBy(
  data: {
    total?: Record<string, number>;
    completed?: Record<string, { count: number; min?: Date; max?: Date }>;
    cancelled?: Record<string, number>;
    noShow?: Record<string, number>;
    byService?: Record<string, Record<string, number>>; // customerId -> serviceId -> count
  },
  pageRows: { customerId: string }[] = [],
) {
  return jest.fn((args: BookingGroupByArgs) => {
    const byServiceShape = args.by.includes('serviceId');
    if (byServiceShape) {
      const rows = Object.entries(data.byService ?? {}).flatMap(
        ([customerId, byService]) =>
          Object.entries(byService).map(([serviceId, count]) => ({
            customerId,
            serviceId,
            _count: { _all: count },
          })),
      );
      return Promise.resolve(rows);
    }
    if (args.where.status === 'COMPLETED') {
      const rows = Object.entries(data.completed ?? {}).map(([customerId, v]) => ({
        customerId,
        _count: { _all: v.count },
        _min: { slotStart: v.min ?? null },
        _max: { slotStart: v.max ?? null },
      }));
      return Promise.resolve(rows);
    }
    if (args.where.status === 'CANCELLED') {
      const rows = Object.entries(data.cancelled ?? {}).map(([customerId, count]) => ({
        customerId,
        _count: { _all: count },
      }));
      return Promise.resolve(rows);
    }
    if (args.where.status === 'NO_SHOW') {
      const rows = Object.entries(data.noShow ?? {}).map(([customerId, count]) => ({
        customerId,
        _count: { _all: count },
      }));
      return Promise.resolve(rows);
    }
    // No status filter, by:['customerId'] only — either list()'s own page query (has `skip`,
    // since it paginates) or buildSummaries' "total" aggregate (no `skip`). That's the one
    // reliable structural difference between the two calls' arg shapes.
    if (typeof args.skip === 'number') {
      return Promise.resolve(pageRows);
    }
    const rows = Object.entries(data.total ?? {}).map(([customerId, count]) => ({
      customerId,
      _count: { _all: count },
    }));
    return Promise.resolve(rows);
  });
}

describe('DashboardCustomersService', () => {
  let service: DashboardCustomersService;
  let prisma: {
    booking: { groupBy: jest.Mock };
    queueEntry: { groupBy: jest.Mock };
    user: { findMany: jest.Mock };
    service: { findMany: jest.Mock };
    salonStaff: { findMany: jest.Mock };
  };
  let salonAccess: { assertAccess: jest.Mock<Promise<void>, [string, string]> };

  function setup(overrides: {
    total?: Record<string, number>;
    completed?: Record<string, { count: number; min?: Date; max?: Date }>;
    cancelled?: Record<string, number>;
    noShow?: Record<string, number>;
    byService?: Record<string, Record<string, number>>;
    pageRows?: { customerId: string }[];
    users?: { id: string; phone: string | null; email: string | null }[];
    staffGroupRows?: {
      customerId: string | null;
      assignedStaffId: string | null;
      _count: { _all: number };
    }[];
  }) {
    prisma.booking.groupBy = makeBookingGroupBy(overrides, overrides.pageRows ?? []);
    prisma.queueEntry.groupBy = jest.fn().mockResolvedValue(overrides.staffGroupRows ?? []);
    prisma.user.findMany = jest.fn().mockResolvedValue(overrides.users ?? []);
  }

  beforeEach(async () => {
    prisma = {
      booking: { groupBy: jest.fn().mockResolvedValue([]) },
      queueEntry: { groupBy: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      service: { findMany: jest.fn().mockResolvedValue([]) },
      salonStaff: { findMany: jest.fn().mockResolvedValue([]) },
    };
    salonAccess = {
      assertAccess: jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardCustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalonAccessService, useValue: salonAccess },
      ],
    }).compile();
    service = moduleRef.get(DashboardCustomersService);
  });

  describe('list', () => {
    it('checks salon access before reading anything', async () => {
      setup({ pageRows: [] });
      await service.list('owner1', 's1', undefined, undefined);
      expect(salonAccess.assertAccess).toHaveBeenCalledWith('owner1', 's1');
    });

    it('rejects an owner who does not operate this salon', async () => {
      salonAccess.assertAccess.mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.list('owner-b', 's1', undefined, undefined),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.booking.groupBy).not.toHaveBeenCalled();
    });

    it('returns an empty page with no further queries when the salon has no customers yet', async () => {
      setup({ pageRows: [] });
      const result = await service.list('owner1', 's1', undefined, undefined);
      expect(result).toEqual({ items: [], nextCursor: null });
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('encodes the next offset as a string cursor when more customers remain', async () => {
      const pageRows = Array.from({ length: 21 }, (_, i) => ({ customerId: `c${i}` }));
      setup({
        pageRows,
        total: Object.fromEntries(pageRows.map((r) => [r.customerId, 1])),
        users: pageRows.map((r) => ({ id: r.customerId, phone: null, email: null })),
      });
      const result = await service.list('owner1', 's1', undefined, '20');
      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).toBe('20');
    });
  });

  describe('getOne', () => {
    it('throws BOOKING_NOT_FOUND when this customer has no bookings at this salon', async () => {
      setup({});
      await expect(
        service.getOne('owner1', 's1', 'ghost-customer'),
      ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    });

    it('returns totals, first/last visit and cancelled/no-show counts', async () => {
      const firstVisit = new Date('2026-01-05T10:00:00.000Z');
      const lastVisit = new Date('2026-03-10T10:00:00.000Z');
      setup({
        total: { c1: 5 },
        completed: { c1: { count: 3, min: firstVisit, max: lastVisit } },
        cancelled: { c1: 1 },
        noShow: { c1: 1 },
        users: [{ id: 'c1', phone: '+919876543210', email: null }],
      });

      const result = await service.getOne('owner1', 's1', 'c1');

      expect(result).toMatchObject({
        customerId: 'c1',
        phone: '+919876543210',
        totalBookings: 5,
        completedCount: 3,
        cancelledCount: 1,
        noShowCount: 1,
        firstVisitAt: firstVisit.toISOString(),
        lastVisitAt: lastVisit.toISOString(),
      });
    });

    it.each([
      [0, null],
      [1, 'new'],
      [2, 'repeat'],
      [FREQUENT_CUSTOMER_THRESHOLD - 1, 'repeat'],
      [FREQUENT_CUSTOMER_THRESHOLD, 'frequent'],
    ])('segments a customer with %i completed visits as %s', async (count, expected) => {
      setup({
        total: { c1: count || 1 }, // total must be >0 for the customer to appear at all
        completed: count > 0 ? { c1: { count } } : {},
        users: [{ id: 'c1', phone: null, email: null }],
      });
      const result = await service.getOne('owner1', 's1', 'c1');
      expect(result.segment).toBe(expected);
    });

    it('resolves preferredServiceName from the service with the highest completed count', async () => {
      setup({
        total: { c1: 4 },
        completed: { c1: { count: 4 } },
        byService: { c1: { 'svc-haircut': 3, 'svc-shave': 1 } },
        users: [{ id: 'c1', phone: null, email: null }],
      });
      prisma.service.findMany = jest
        .fn()
        .mockResolvedValue([{ id: 'svc-haircut', name: 'Haircut' }]);

      const result = await service.getOne('owner1', 's1', 'c1');

      expect(prisma.service.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['svc-haircut'] } } }),
      );
      expect(result.preferredServiceName).toBe('Haircut');
    });

    it('resolves preferredStaffName from the most-frequent assigned barber', async () => {
      setup({
        total: { c1: 3 },
        completed: { c1: { count: 3 } },
        users: [{ id: 'c1', phone: null, email: null }],
        staffGroupRows: [
          { customerId: 'c1', assignedStaffId: 'st1', _count: { _all: 2 } },
          { customerId: 'c1', assignedStaffId: 'st2', _count: { _all: 1 } },
        ],
      });
      prisma.salonStaff.findMany = jest
        .fn()
        .mockResolvedValue([{ id: 'st1', displayName: 'Marcus' }]);

      const result = await service.getOne('owner1', 's1', 'c1');

      expect(result.preferredStaffName).toBe('Marcus');
    });

    it('has null preferredServiceName/preferredStaffName when nothing is derivable', async () => {
      setup({
        total: { c1: 1 },
        users: [{ id: 'c1', phone: null, email: null }],
      });
      const result = await service.getOne('owner1', 's1', 'c1');
      expect(result.preferredServiceName).toBeNull();
      expect(result.preferredStaffName).toBeNull();
    });
  });
});
