import { Test } from '@nestjs/testing';
import { DashboardBookingsService } from './dashboard-bookings.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

function decimal(value: string) {
  return { toString: () => value } as unknown as number;
}

function makeBookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    salonId: 's1',
    customerId: 'c1',
    serviceId: 'sv1',
    slotStart: new Date('2026-06-01T10:00:00.000Z'),
    slotEnd: new Date('2026-06-01T10:30:00.000Z'),
    status: 'CONFIRMED',
    source: 'WEB',
    preferredStaffId: null,
    prepaymentRequiredAmount: null,
    cancellationChargeAmount: null,
    selectedStyleName: null,
    createdAt: new Date('2026-05-20T09:00:00.000Z'),
    updatedAt: new Date('2026-05-20T09:00:00.000Z'),
    cancelledAt: null,
    salon: {
      name: 'BarberCue Demo Salon',
      slug: 'barbercue-demo',
      currency: 'INR',
      addressLine: '12 MG Road',
      lat: 12.97,
      lng: 77.59,
      city: { slug: 'bengaluru', countryCode: 'IN' },
    },
    service: { name: 'Haircut', durationMinutes: 30, price: decimal('300') },
    preferredStaff: null,
    customer: { phone: '+919876543210', email: null },
    queueEntries: [],
    ...overrides,
  };
}

interface PrismaMock {
  booking: {
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
  };
}

describe('DashboardBookingsService', () => {
  let service: DashboardBookingsService;
  let prisma: PrismaMock;
  let salonAccess: { assertAccess: jest.Mock<Promise<void>, [string, string]> };

  beforeEach(async () => {
    prisma = {
      booking: {
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
        findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
      },
    };
    salonAccess = {
      assertAccess: jest
        .fn<Promise<void>, [string, string]>()
        .mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardBookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalonAccessService, useValue: salonAccess },
      ],
    }).compile();
    service = moduleRef.get(DashboardBookingsService);
  });

  describe('authorization', () => {
    it('checks salon access before listing bookings', async () => {
      prisma.booking.findMany.mockResolvedValueOnce([]);
      await service.list('owner1', 's1', undefined, undefined, undefined, undefined, undefined);
      expect(salonAccess.assertAccess).toHaveBeenCalledWith('owner1', 's1');
    });

    it('rejects an owner who does not operate this salon (cross-owner access)', async () => {
      salonAccess.assertAccess.mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.list('owner-b', 's1', undefined, undefined, undefined, undefined, undefined),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.booking.findMany).not.toHaveBeenCalled();
    });

    it('rejects a booking-detail request for a booking in a different salon', async () => {
      salonAccess.assertAccess.mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.getOne('owner-b', 's-other', 'b1'),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.booking.findFirst).not.toHaveBeenCalled();
    });

    it('scopes getOne to the given salonId, not just the booking id', async () => {
      prisma.booking.findFirst.mockResolvedValueOnce(null);
      await expect(service.getOne('owner1', 's1', 'b1')).rejects.toMatchObject({
        code: 'BOOKING_NOT_FOUND',
      });
      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'b1', salonId: 's1' } }),
      );
    });
  });

  describe('filters', () => {
    it('rejects an unknown filter value', async () => {
      await expect(
        service.list('owner1', 's1', 'bogus', undefined, undefined, undefined, undefined),
      ).rejects.toMatchObject({ code: 'INVALID_FILTER' });
      expect(prisma.booking.findMany).not.toHaveBeenCalled();
    });

    it('filters by status for completed/cancelled/no_show', async () => {
      prisma.booking.findMany.mockResolvedValue([]);
      await service.list('owner1', 's1', 'completed', undefined, undefined, undefined, undefined);
      expect(prisma.booking.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ salonId: 's1', status: 'COMPLETED' }),
        }),
      );

      await service.list('owner1', 's1', 'cancelled', undefined, undefined, undefined, undefined);
      expect(prisma.booking.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'CANCELLED' }) }),
      );

      await service.list('owner1', 's1', 'no_show', undefined, undefined, undefined, undefined);
      expect(prisma.booking.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'NO_SHOW' }) }),
      );
    });

    it('"all" applies no status filter and defaults when filter is omitted', async () => {
      prisma.booking.findMany.mockResolvedValue([]);
      await service.list('owner1', 's1', undefined, undefined, undefined, undefined, undefined);
      const call = prisma.booking.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(call.where).toEqual({ salonId: 's1' });
    });

    it('"upcoming" restricts to active statuses only', async () => {
      prisma.booking.findMany.mockResolvedValue([]);
      await service.list('owner1', 's1', 'upcoming', undefined, undefined, undefined, undefined);
      const call = prisma.booking.findMany.mock.calls[0][0] as {
        where: { status: { in: string[] } };
      };
      expect(call.where.status.in).toEqual(['CONFIRMED', 'PENDING_PAYMENT']);
    });
  });

  describe('pagination', () => {
    it('reports nextCursor only when more rows exist beyond the page limit', async () => {
      const rows = Array.from({ length: 3 }, (_, i) =>
        makeBookingRow({ id: `b${i}` }),
      );
      prisma.booking.findMany.mockResolvedValueOnce(rows);
      const result = await service.list(
        'owner1',
        's1',
        'all',
        undefined,
        '2',
        undefined,
        undefined,
      );
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('b1');
    });

    it('passes the cursor through as a Prisma cursor/skip pair', async () => {
      prisma.booking.findMany.mockResolvedValueOnce([]);
      await service.list('owner1', 's1', 'all', 'b5', undefined, undefined, undefined);
      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'b5' }, skip: 1 }),
      );
    });
  });

  describe('DTO shape', () => {
    it('never exposes internal ids/hashes beyond documented safe fields', async () => {
      prisma.booking.findFirst.mockResolvedValueOnce(
        makeBookingRow({
          queueEntries: [
            { assignedStaffId: 'st1', assignedStaff: { displayName: 'Sam' } },
          ],
        }),
      );
      const dto = await service.getOne('owner1', 's1', 'b1');
      expect(dto).toMatchObject({
        id: 'b1',
        customerPhone: '+919876543210',
        assignedStaffId: 'st1',
        assignedStaffName: 'Sam',
        createdAt: '2026-05-20T09:00:00.000Z',
      });
      expect(dto).not.toHaveProperty('passwordHash');
      expect(dto).not.toHaveProperty('idempotencyKey');
    });

    it('leaves assignedStaff null until the booking has a queue entry', async () => {
      prisma.booking.findFirst.mockResolvedValueOnce(makeBookingRow());
      const dto = await service.getOne('owner1', 's1', 'b1');
      expect(dto.assignedStaffId).toBeNull();
      expect(dto.assignedStaffName).toBeNull();
    });
  });
});
