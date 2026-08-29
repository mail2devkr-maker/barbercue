import { setStaffWorkingHoursSchema } from '@barbercue/shared';
import { StaffWorkingHoursService } from './staff-working-hours.service';

const week = (over: Partial<Record<number, Record<string, unknown>>> = {}) =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    openTime: '09:00',
    closeTime: '21:00',
    isClosed: false,
    ...(over[dayOfWeek] ?? {}),
  }));

describe('StaffWorkingHoursService', () => {
  let service: StaffWorkingHoursService;
  let prisma: {
    salonStaff: { findFirst: jest.Mock };
    staffWorkingHours: { findMany: jest.Mock; upsert: jest.Mock };
    $transaction: jest.Mock;
  };
  let salonAccess: { assertAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      salonStaff: {
        findFirst: jest.fn().mockResolvedValue({ id: 'staff-1', salonId: 'salon-1' }),
      },
      staffWorkingHours: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn((args: unknown) => args),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    salonAccess = { assertAccess: jest.fn().mockResolvedValue(undefined) };
    service = new StaffWorkingHoursService(prisma as never, salonAccess as never);
  });

  describe('list', () => {
    it('checks salon access before reading anything', async () => {
      await service.list('owner-1', 'salon-1', 'staff-1');
      expect(salonAccess.assertAccess).toHaveBeenCalledWith('owner-1', 'salon-1');
    });

    it('rejects a staffId that does not belong to this salon', async () => {
      prisma.salonStaff.findFirst.mockResolvedValue(null);
      await expect(
        service.list('owner-1', 'salon-1', 'someone-elses-staff'),
      ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
      expect(prisma.staffWorkingHours.findMany).not.toHaveBeenCalled();
    });

    // The opposite default from OperatingHours — a barber who never configured hours should not
    // silently vanish from every slot.
    it('returns 7 unrestricted (not closed) days for a barber who has never set hours', async () => {
      prisma.staffWorkingHours.findMany.mockResolvedValue([]);

      const result = await service.list('owner-1', 'salon-1', 'staff-1');

      expect(result).toHaveLength(7);
      expect(result.map((d) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(result.every((d) => !d.isClosed)).toBe(true);
      expect(result.every((d) => !d.configured)).toBe(true);
    });

    it('merges stored rows over the unrestricted default and marks them configured', async () => {
      prisma.staffWorkingHours.findMany.mockResolvedValue([
        { dayOfWeek: 3, openTime: '10:00', closeTime: '19:30', isClosed: false },
      ]);

      const result = await service.list('owner-1', 'salon-1', 'staff-1');

      expect(result[3]).toEqual({
        dayOfWeek: 3,
        openTime: '10:00',
        closeTime: '19:30',
        isClosed: false,
        configured: true,
      });
      expect(result[0].configured).toBe(false);
    });

    it('refuses to read another owner\'s salon', async () => {
      salonAccess.assertAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.list('intruder', 'someone-elses-salon', 'staff-1'),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.staffWorkingHours.findMany).not.toHaveBeenCalled();
    });
  });

  describe('set', () => {
    it('writes all 7 days in a single transaction, scoped to the staffId', async () => {
      await service.set('owner-1', 'salon-1', 'staff-1', { days: week() });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.staffWorkingHours.upsert).toHaveBeenCalledTimes(7);
      const first = prisma.staffWorkingHours.upsert.mock.calls[0][0] as {
        where: { staffId_dayOfWeek: { staffId: string; dayOfWeek: number } };
        create: { staffId: string };
      };
      expect(first.where.staffId_dayOfWeek).toEqual({
        staffId: 'staff-1',
        dayOfWeek: 0,
      });
      expect(first.create.staffId).toBe('staff-1');
    });

    it('rejects a staffId that does not belong to this salon before writing anything', async () => {
      prisma.salonStaff.findFirst.mockResolvedValue(null);
      await expect(
        service.set('owner-1', 'salon-1', 'someone-elses-staff', { days: week() }),
      ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('checks access before writing anything', async () => {
      salonAccess.assertAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.set('intruder', 'someone-elses-salon', 'staff-1', { days: week() }),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.staffWorkingHours.upsert).not.toHaveBeenCalled();
    });
  });

  // Validation lives in the shared schema (reused verbatim from operatingHoursEntrySchema), so it
  // is exercised here directly rather than through a second HTTP-shaped test.
  describe('setStaffWorkingHoursSchema', () => {
    const parse = (days: unknown) => setStaffWorkingHoursSchema.safeParse({ days });

    it('accepts a well-formed week', () => {
      expect(parse(week()).success).toBe(true);
    });

    it('rejects a week that is not exactly 7 days', () => {
      expect(parse(week().slice(0, 6)).success).toBe(false);
    });

    it('rejects closing before opening on an open day', () => {
      const r = parse(week({ 4: { openTime: '20:00', closeTime: '02:00' } }));
      expect(r.success).toBe(false);
    });
  });
});
