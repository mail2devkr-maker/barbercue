import { setOperatingHoursSchema } from '@barbercue/shared';
import { SalonOperatingHoursService } from './salon-operating-hours.service';

const week = (over: Partial<Record<number, Record<string, unknown>>> = {}) =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    openTime: '09:00',
    closeTime: '21:00',
    isClosed: false,
    ...(over[dayOfWeek] ?? {}),
  }));

describe('SalonOperatingHoursService', () => {
  let service: SalonOperatingHoursService;
  let prisma: {
    operatingHours: { findMany: jest.Mock; upsert: jest.Mock };
    $transaction: jest.Mock;
    auditLog: { create: jest.Mock };
  };
  let salonAccess: { assertOwnerOrAdminAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      operatingHours: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn((args: unknown) => args),
      },
      // The service passes an array of upsert promises; the real client runs them atomically.
      $transaction: jest.fn().mockResolvedValue([]),
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    salonAccess = { assertOwnerOrAdminAccess: jest.fn().mockResolvedValue('OWNER') };
    service = new SalonOperatingHoursService(
      prisma as never,
      salonAccess as never,
    );
  });

  describe('list', () => {
    it('checks salon access before reading anything', async () => {
      await service.list('owner-1', 'salon-1');
      expect(salonAccess.assertOwnerOrAdminAccess).toHaveBeenCalledWith(
        'owner-1',
        'salon-1',
      );
    });

    // A brand-new salon has no rows at all; the UI still needs a stable 7-entry shape to render.
    it('returns 7 closed days for a salon that has never set hours', async () => {
      prisma.operatingHours.findMany.mockResolvedValue([]);

      const result = await service.list('owner-1', 'salon-1');

      expect(result).toHaveLength(7);
      expect(result.map((d) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(result.every((d) => d.isClosed)).toBe(true);
    });

    it('merges stored rows over the closed default, keeping Sunday..Saturday order', async () => {
      prisma.operatingHours.findMany.mockResolvedValue([
        {
          dayOfWeek: 3,
          openTime: '10:00',
          closeTime: '19:30',
          isClosed: false,
        },
      ]);

      const result = await service.list('owner-1', 'salon-1');

      expect(result[3]).toEqual({
        dayOfWeek: 3,
        openTime: '10:00',
        closeTime: '19:30',
        isClosed: false,
      });
      expect(result[0].isClosed).toBe(true);
      expect(result).toHaveLength(7);
    });

    it('refuses to read another owner’s salon', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.list('intruder', 'someone-elses-salon'),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.operatingHours.findMany).not.toHaveBeenCalled();
    });
  });

  describe('set', () => {
    it('writes all 7 days in a single transaction, scoped to the salon', async () => {
      await service.set('owner-1', 'salon-1', { days: week() });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.operatingHours.upsert).toHaveBeenCalledTimes(7);
      const first = prisma.operatingHours.upsert.mock.calls[0][0] as {
        where: { salonId_dayOfWeek: { salonId: string; dayOfWeek: number } };
        create: { salonId: string };
      };
      expect(first.where.salonId_dayOfWeek).toEqual({
        salonId: 'salon-1',
        dayOfWeek: 0,
      });
      expect(first.create.salonId).toBe('salon-1');
    });

    it('upserts rather than deleting, so a concurrent availability read never sees zero hours', async () => {
      await service.set('owner-1', 'salon-1', { days: week() });
      expect(
        (prisma.operatingHours as unknown as Record<string, unknown>)
          .deleteMany,
      ).toBeUndefined();
      expect(prisma.operatingHours.upsert).toHaveBeenCalled();
    });

    it('checks access before writing anything', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.set('intruder', 'someone-elses-salon', { days: week() }),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.operatingHours.upsert).not.toHaveBeenCalled();
    });

    it('persists a closed day without discarding its stored times', async () => {
      await service.set('owner-1', 'salon-1', {
        days: week({ 1: { isClosed: true } }),
      });

      const monday = prisma.operatingHours.upsert.mock.calls[1][0] as {
        create: { isClosed: boolean; openTime: string };
      };
      expect(monday.create.isClosed).toBe(true);
      expect(monday.create.openTime).toBe('09:00');
    });

    it('an owner update never writes an AuditLog row', async () => {
      await service.set('owner-1', 'salon-1', { days: week() });
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    // Part 2 — PLATFORM_ADMIN delegated shop management.
    it('PLATFORM_ADMIN managing an ACTIVE salon can set hours and it is recorded under the real admin actor', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValue('PLATFORM_ADMIN');
      await service.set('admin-1', 'salon-1', { days: week() });
      expect(prisma.operatingHours.upsert).toHaveBeenCalledTimes(7);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'ADMIN_OPERATING_HOURS_UPDATED',
          entityType: 'Salon',
          entityId: 'salon-1',
        }),
      });
    });
  });

  // Validation lives in the shared schema (the same object the controller's ZodValidationPipe
  // uses), so it is exercised here directly rather than through a second HTTP-shaped test.
  describe('setOperatingHoursSchema', () => {
    const parse = (days: unknown) =>
      setOperatingHoursSchema.safeParse({ days });

    it('accepts a well-formed week', () => {
      expect(parse(week()).success).toBe(true);
    });

    it('rejects a week that is not exactly 7 days', () => {
      expect(parse(week().slice(0, 6)).success).toBe(false);
    });

    it('rejects duplicate days even when the count is 7', () => {
      const days = week();
      days[6].dayOfWeek = 0;
      const r = parse(days);
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0].message).toMatch(/one entry for each day/i);
      }
    });

    it.each(['9:00', '24:00', '09:60', 'morning', '09-00', ''])(
      'rejects malformed time %p',
      (bad) => {
        expect(parse(week({ 2: { openTime: bad } })).success).toBe(false);
      },
    );

    // The availability engine resolves open/close inside one IST calendar day, so an overnight
    // window would silently produce no slots rather than a late-night salon.
    it('rejects closing before opening on an open day', () => {
      const r = parse(week({ 4: { openTime: '20:00', closeTime: '02:00' } }));
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0].message).toMatch(/after opening time/i);
      }
    });

    it('allows any times on a closed day, since availability ignores them', () => {
      expect(
        parse(
          week({
            0: { openTime: '20:00', closeTime: '02:00', isClosed: true },
          }),
        ).success,
      ).toBe(true);
    });

    it('rejects an out-of-range dayOfWeek', () => {
      expect(parse(week({ 5: { dayOfWeek: 7 } })).success).toBe(false);
    });
  });
});
