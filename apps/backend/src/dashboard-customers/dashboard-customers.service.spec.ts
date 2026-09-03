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
      const rows = Object.entries(data.completed ?? {}).map(
        ([customerId, v]) => ({
          customerId,
          _count: { _all: v.count },
          _min: { slotStart: v.min ?? null },
          _max: { slotStart: v.max ?? null },
        }),
      );
      return Promise.resolve(rows);
    }
    if (args.where.status === 'CANCELLED') {
      const rows = Object.entries(data.cancelled ?? {}).map(
        ([customerId, count]) => ({
          customerId,
          _count: { _all: count },
        }),
      );
      return Promise.resolve(rows);
    }
    if (args.where.status === 'NO_SHOW') {
      const rows = Object.entries(data.noShow ?? {}).map(
        ([customerId, count]) => ({
          customerId,
          _count: { _all: count },
        }),
      );
      return Promise.resolve(rows);
    }
    // No status filter, by:['customerId'] only — either list()'s own page query (has `skip`,
    // since it paginates) or buildSummaries' "total" aggregate (no `skip`). That's the one
    // reliable structural difference between the two calls' arg shapes.
    if (typeof args.skip === 'number') {
      return Promise.resolve(pageRows);
    }
    const rows = Object.entries(data.total ?? {}).map(
      ([customerId, count]) => ({
        customerId,
        _count: { _all: count },
      }),
    );
    return Promise.resolve(rows);
  });
}

describe('DashboardCustomersService', () => {
  let service: DashboardCustomersService;
  let prisma: {
    salon: { findUnique: jest.Mock };
    booking: { groupBy: jest.Mock; count: jest.Mock };
    queueEntry: { groupBy: jest.Mock };
    user: { findMany: jest.Mock };
    service: { findMany: jest.Mock };
    salonStaff: { findMany: jest.Mock };
    customerLedgerEntry: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      updateMany: jest.Mock;
    };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let salonAccess: {
    assertOwnerAccess: jest.Mock<Promise<void>, [string, string]>;
  };

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
    prisma.booking.groupBy = makeBookingGroupBy(
      overrides,
      overrides.pageRows ?? [],
    );
    prisma.queueEntry.groupBy = jest
      .fn()
      .mockResolvedValue(overrides.staffGroupRows ?? []);
    prisma.user.findMany = jest.fn().mockResolvedValue(overrides.users ?? []);
  }

  beforeEach(async () => {
    prisma = {
      salon: { findUnique: jest.fn().mockResolvedValue({ currency: 'INR' }) },
      booking: { groupBy: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      queueEntry: { groupBy: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      service: { findMany: jest.fn().mockResolvedValue([]) },
      salonStaff: { findMany: jest.fn().mockResolvedValue([]) },
      customerLedgerEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    // Interactive-transaction mock, same shape as bookings.service.spec.ts: run the callback
    // against `prisma` itself since every model method it touches is already mocked above.
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
    salonAccess = {
      assertOwnerAccess: jest
        .fn<Promise<void>, [string, string]>()
        .mockResolvedValue(undefined),
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
      expect(salonAccess.assertOwnerAccess).toHaveBeenCalledWith(
        'owner1',
        's1',
      );
    });

    it('rejects an owner who does not operate this salon', async () => {
      salonAccess.assertOwnerAccess.mockRejectedValueOnce(
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
      const pageRows = Array.from({ length: 21 }, (_, i) => ({
        customerId: `c${i}`,
      }));
      setup({
        pageRows,
        total: Object.fromEntries(pageRows.map((r) => [r.customerId, 1])),
        users: pageRows.map((r) => ({
          id: r.customerId,
          phone: null,
          email: null,
        })),
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
    ])(
      'segments a customer with %i completed visits as %s',
      async (count, expected) => {
        setup({
          total: { c1: count || 1 }, // total must be >0 for the customer to appear at all
          completed: count > 0 ? { c1: { count } } : {},
          users: [{ id: 'c1', phone: null, email: null }],
        });
        const result = await service.getOne('owner1', 's1', 'c1');
        expect(result.segment).toBe(expected);
      },
    );

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

    it('exposes newCustomerGraceEligible, ledgerEntries and outstandingTotalAmount', async () => {
      setup({
        total: { c1: 1 },
        completed: { c1: { count: 1 } },
        users: [{ id: 'c1', phone: null, email: null }],
      });
      prisma.customerLedgerEntry.findMany.mockResolvedValue([
        {
          id: 'l1',
          customerId: 'c1',
          salonId: 's1',
          bookingId: 'b1',
          amount: 150,
          reason: 'NO_SHOW_CHARGE',
          status: 'OUTSTANDING',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          settledAt: null,
          booking: { slotStart: new Date('2025-12-30T10:00:00.000Z'), service: { name: 'Haircut' } },
        },
        {
          id: 'l2',
          customerId: 'c1',
          salonId: 's1',
          bookingId: 'b2',
          amount: 50,
          reason: 'NO_SHOW_CHARGE',
          status: 'WAIVED',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          settledAt: null,
          booking: null,
        },
      ]);

      const result = await service.getOne('owner1', 's1', 'c1');

      expect(result.newCustomerGraceEligible).toBe(true);
      expect(result.outstandingTotalAmount).toBe(150);
      expect(result.ledgerEntries).toHaveLength(2);
      expect(result.ledgerEntries[0]).toMatchObject({
        id: 'l1',
        amount: 150,
        reason: 'NO_SHOW_CHARGE',
        status: 'OUTSTANDING',
        bookingServiceName: 'Haircut',
      });
    });

    it('is not newCustomerGraceEligible once completedCount reaches the 3-visit limit', async () => {
      setup({
        total: { c1: 3 },
        completed: { c1: { count: 3 } },
        users: [{ id: 'c1', phone: null, email: null }],
      });
      const result = await service.getOne('owner1', 's1', 'c1');
      expect(result.newCustomerGraceEligible).toBe(false);
    });
  });

  // Part R — New Customer No-Show Grace waive/restore test matrix.
  describe('waiveNoShowDue / restoreNoShowDue', () => {
    function makeLedgerFake(initial: {
      id: string;
      salonId: string;
      customerId: string;
      reason: string;
      status: string;
      amount: number;
      bookingId?: string | null;
    }) {
      const row = {
        id: initial.id,
        customerId: initial.customerId,
        salonId: initial.salonId,
        bookingId: initial.bookingId ?? null,
        amount: initial.amount,
        reason: initial.reason,
        status: initial.status,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        settledAt: null,
        booking: null as { slotStart: Date; service: { name: string } } | null,
      };
      prisma.customerLedgerEntry.findUnique = jest.fn(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === row.id ? { ...row } : null),
      );
      prisma.customerLedgerEntry.updateMany = jest.fn(
        ({ where, data }: { where: Record<string, unknown>; data: { status: string } }) => {
          const matches =
            where.id === row.id &&
            where.salonId === row.salonId &&
            where.customerId === row.customerId &&
            (where.reason === undefined || where.reason === row.reason) &&
            (where.status === undefined || where.status === row.status);
          if (!matches) return Promise.resolve({ count: 0 });
          row.status = data.status;
          return Promise.resolve({ count: 1 });
        },
      );
      prisma.customerLedgerEntry.findUniqueOrThrow = jest.fn(
        ({ where }: { where: { id: string } }) => {
          if (where.id !== row.id) return Promise.reject(new Error('not found'));
          return Promise.resolve({ ...row });
        },
      );
      return row;
    }

    it('1. 0 completed services + NO_SHOW due -> owner can waive', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'OUTSTANDING', amount: 150 });
      prisma.booking.count.mockResolvedValue(0);
      const result = await service.waiveNoShowDue('owner1', 's1', 'c1', 'l1');
      expect(result.ledgerEntry.status).toBe('WAIVED');
    });

    it('2. 1 completed service -> owner can waive', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'OUTSTANDING', amount: 150 });
      prisma.booking.count.mockResolvedValue(1);
      const result = await service.waiveNoShowDue('owner1', 's1', 'c1', 'l1');
      expect(result.ledgerEntry.status).toBe('WAIVED');
    });

    it('3. 2 completed services -> owner can waive', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'OUTSTANDING', amount: 150 });
      prisma.booking.count.mockResolvedValue(2);
      const result = await service.waiveNoShowDue('owner1', 's1', 'c1', 'l1');
      expect(result.ledgerEntry.status).toBe('WAIVED');
    });

    it('4. 3 completed services -> special new-customer waiver rejected', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'OUTSTANDING', amount: 150 });
      prisma.booking.count.mockResolvedValue(3);
      await expect(service.waiveNoShowDue('owner1', 's1', 'c1', 'l1')).rejects.toMatchObject({
        code: 'LEDGER_ENTRY_NOT_WAIVABLE',
      });
    });

    it('5. 4+ completed -> rejected', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'OUTSTANDING', amount: 150 });
      prisma.booking.count.mockResolvedValue(7);
      await expect(service.waiveNoShowDue('owner1', 's1', 'c1', 'l1')).rejects.toMatchObject({
        code: 'LEDGER_ENTRY_NOT_WAIVABLE',
      });
    });

    it('6. CANCELLATION_CHARGE cannot use the New Customer No-Show Grace', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'CANCELLATION_CHARGE', status: 'OUTSTANDING', amount: 75 });
      prisma.booking.count.mockResolvedValue(0);
      await expect(service.waiveNoShowDue('owner1', 's1', 'c1', 'l1')).rejects.toMatchObject({
        code: 'LEDGER_ENTRY_NOT_WAIVABLE',
      });
    });

    it('7. an owner who does not operate this salon is forbidden', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'OUTSTANDING', amount: 150 });
      salonAccess.assertOwnerAccess.mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(service.waiveNoShowDue('owner-b', 's1', 'c1', 'l1')).rejects.toMatchObject({
        code: 'SALON_ACCESS_DENIED',
      });
      expect(prisma.customerLedgerEntry.updateMany).not.toHaveBeenCalled();
    });

    it('8. a ledger entry belonging to a different customer/salon is forbidden (not found)', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'OUTSTANDING', amount: 150 });
      // Real entry belongs to (s1, c1) — requesting it under a different salon must 404, not mutate.
      await expect(service.waiveNoShowDue('owner2', 's2', 'c1', 'l1')).rejects.toMatchObject({
        code: 'LEDGER_ENTRY_NOT_FOUND',
      });
      // Requesting under the right salon but a different customer must also 404.
      await expect(service.waiveNoShowDue('owner1', 's1', 'c-other', 'l1')).rejects.toMatchObject({
        code: 'LEDGER_ENTRY_NOT_FOUND',
      });
      expect(prisma.customerLedgerEntry.updateMany).not.toHaveBeenCalled();
    });

    it('9. OUTSTANDING NO_SHOW transitions to WAIVED', async () => {
      const row = makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'OUTSTANDING', amount: 150 });
      prisma.booking.count.mockResolvedValue(0);
      await service.waiveNoShowDue('owner1', 's1', 'c1', 'l1');
      expect(row.status).toBe('WAIVED');
    });

    it('10. WAIVED is restored to OUTSTANDING', async () => {
      const row = makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'WAIVED', amount: 150 });
      const result = await service.restoreNoShowDue('owner1', 's1', 'c1', 'l1');
      expect(result.ledgerEntry.status).toBe('OUTSTANDING');
      expect(row.status).toBe('OUTSTANDING');
    });

    it('14. writes a NO_SHOW_DUE_WAIVED AuditLog row', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'OUTSTANDING', amount: 150, bookingId: 'b1' });
      prisma.booking.count.mockResolvedValue(1);
      await service.waiveNoShowDue('owner1', 's1', 'c1', 'l1');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'NO_SHOW_DUE_WAIVED',
            actorUserId: 'owner1',
            entityId: 'l1',
            metadata: expect.objectContaining({
              ledgerEntryId: 'l1',
              customerId: 'c1',
              salonId: 's1',
              bookingId: 'b1',
              amount: 150,
              completedVisitCount: 1,
              previousStatus: 'OUTSTANDING',
              newStatus: 'WAIVED',
            }),
          }),
        }),
      );
    });

    it('15. writes a NO_SHOW_DUE_RESTORED AuditLog row', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'WAIVED', amount: 150, bookingId: 'b1' });
      await service.restoreNoShowDue('owner1', 's1', 'c1', 'l1');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'NO_SHOW_DUE_RESTORED',
            actorUserId: 'owner1',
            entityId: 'l1',
            metadata: expect.objectContaining({
              previousStatus: 'WAIVED',
              newStatus: 'OUTSTANDING',
            }),
          }),
        }),
      );
    });

    it('16. a retried waive on an already-WAIVED entry is idempotent: no duplicate audit row, no error', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'OUTSTANDING', amount: 150 });
      prisma.booking.count.mockResolvedValue(0);
      await service.waiveNoShowDue('owner1', 's1', 'c1', 'l1');
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);

      const second = await service.waiveNoShowDue('owner1', 's1', 'c1', 'l1');
      expect(second.ledgerEntry.status).toBe('WAIVED');
      // No second transition, no second audit row — the retry is a pure no-op read.
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('16b. a retried restore on an already-OUTSTANDING entry is idempotent: no duplicate audit row', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'WAIVED', amount: 150 });
      await service.restoreNoShowDue('owner1', 's1', 'c1', 'l1');
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);

      const second = await service.restoreNoShowDue('owner1', 's1', 'c1', 'l1');
      expect(second.ledgerEntry.status).toBe('OUTSTANDING');
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects restoring an entry that is not WAIVED', async () => {
      makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'SETTLED', amount: 150 });
      await expect(service.restoreNoShowDue('owner1', 's1', 'c1', 'l1')).rejects.toMatchObject({
        code: 'LEDGER_ENTRY_NOT_RESTORABLE',
      });
    });

    it('never converts WAIVED into SETTLED, and never deletes the ledger row', async () => {
      const row = makeLedgerFake({ id: 'l1', salonId: 's1', customerId: 'c1', reason: 'NO_SHOW_CHARGE', status: 'OUTSTANDING', amount: 150 });
      prisma.booking.count.mockResolvedValue(0);
      await service.waiveNoShowDue('owner1', 's1', 'c1', 'l1');
      expect(row.status).toBe('WAIVED');
      expect(prisma.customerLedgerEntry.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'SETTLED' } }),
      );
    });
  });
});
