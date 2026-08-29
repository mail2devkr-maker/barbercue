import { Test } from '@nestjs/testing';
import { AvailabilityService } from './availability.service';
import { PrismaService } from '../prisma/prisma.service';

function futureDateString(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

interface PrismaMock {
  salon: { findUnique: jest.Mock<Promise<unknown>, [unknown]> };
  service: { findFirst: jest.Mock<Promise<unknown>, [unknown]> };
  staffService: { count: jest.Mock<Promise<number>, [unknown]> };
  salonStaff: {
    count: jest.Mock<Promise<number>, [unknown]>;
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
  };
  chair: { count: jest.Mock<Promise<number>, [unknown]> };
  operatingHours: { findUnique: jest.Mock<Promise<unknown>, [unknown]> };
  staffWorkingHours: { findUnique: jest.Mock<Promise<unknown>, [unknown]> };
  booking: { findMany: jest.Mock<Promise<unknown[]>, [unknown]> };
}

describe('AvailabilityService', () => {
  let service: AvailabilityService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      salon: { findUnique: jest.fn<Promise<unknown>, [unknown]>() },
      service: { findFirst: jest.fn<Promise<unknown>, [unknown]>() },
      staffService: { count: jest.fn<Promise<number>, [unknown]>() },
      salonStaff: {
        count: jest.fn<Promise<number>, [unknown]>(),
        findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      },
      chair: { count: jest.fn<Promise<number>, [unknown]>() },
      operatingHours: { findUnique: jest.fn<Promise<unknown>, [unknown]>() },
      staffWorkingHours: {
        findUnique: jest.fn<Promise<unknown>, [unknown]>(),
      },
      booking: { findMany: jest.fn<Promise<unknown[]>, [unknown]>() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AvailabilityService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AvailabilityService);
  });

  describe('getSalonOrThrow', () => {
    it('throws SALON_NOT_FOUND when the salon does not exist', async () => {
      prisma.salon.findUnique.mockResolvedValue(null);
      await expect(service.getSalonOrThrow('s1')).rejects.toMatchObject({
        code: 'SALON_NOT_FOUND',
      });
    });

    it('throws SALON_NOT_FOUND when the salon is not ACTIVE', async () => {
      prisma.salon.findUnique.mockResolvedValue({
        id: 's1',
        status: 'PENDING',
      });
      await expect(service.getSalonOrThrow('s1')).rejects.toMatchObject({
        code: 'SALON_NOT_FOUND',
      });
    });

    it('returns the salon when ACTIVE', async () => {
      prisma.salon.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE' });
      await expect(service.getSalonOrThrow('s1')).resolves.toMatchObject({
        id: 's1',
      });
    });
  });

  describe('getServiceOrThrow', () => {
    it('throws SERVICE_NOT_FOUND when no matching active service exists', async () => {
      prisma.service.findFirst.mockResolvedValue(null);
      await expect(
        service.getServiceOrThrow('s1', 'sv1'),
      ).rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND' });
    });
  });

  describe('assertStaffQualified', () => {
    it('passes when every ACTIVE staff qualifies (zero StaffService rows for the service)', async () => {
      prisma.staffService.count.mockResolvedValue(0);
      prisma.salonStaff.findFirst.mockResolvedValue({ id: 'st1' });
      await expect(
        service.assertStaffQualified('s1', 'sv1', 'st1'),
      ).resolves.toBeUndefined();
    });

    it('throws STAFF_NOT_QUALIFIED when StaffService rows exist and this staff has none', async () => {
      prisma.staffService.count.mockResolvedValue(2);
      prisma.salonStaff.findFirst.mockResolvedValueOnce(null); // qualified lookup fails
      prisma.salonStaff.findFirst.mockResolvedValueOnce({ id: 'st1' }); // but staff does exist at the salon
      await expect(
        service.assertStaffQualified('s1', 'sv1', 'st1'),
      ).rejects.toMatchObject({
        code: 'STAFF_NOT_QUALIFIED',
      });
    });

    it('throws STAFF_NOT_FOUND when the staff does not belong to the salon at all', async () => {
      prisma.staffService.count.mockResolvedValue(0);
      prisma.salonStaff.findFirst.mockResolvedValueOnce(null);
      prisma.salonStaff.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.assertStaffQualified('s1', 'sv1', 'st1'),
      ).rejects.toMatchObject({
        code: 'STAFF_NOT_FOUND',
      });
    });
  });

  describe('listQualifiedStaff (Phase 17 — Barber Professional Profile)', () => {
    it('includes photoUrl/bio/yearsExperience on each option', async () => {
      prisma.service.findFirst.mockResolvedValue({ id: 'sv1' });
      prisma.staffService.count.mockResolvedValue(0);
      prisma.salonStaff.findMany.mockResolvedValue([
        {
          id: 'st1',
          displayName: 'Marcus',
          photoUrl: 'https://example.com/marcus.jpg',
          bio: 'Fades and tapers specialist.',
          yearsExperience: 8,
        },
        {
          id: 'st2',
          displayName: 'Priya',
          photoUrl: null,
          bio: null,
          yearsExperience: null,
        },
      ]);
      const result = await service.listQualifiedStaff('s1', 'sv1');
      expect(result).toEqual([
        {
          id: 'st1',
          displayName: 'Marcus',
          photoUrl: 'https://example.com/marcus.jpg',
          bio: 'Fades and tapers specialist.',
          yearsExperience: 8,
        },
        {
          id: 'st2',
          displayName: 'Priya',
          photoUrl: null,
          bio: null,
          yearsExperience: null,
        },
      ]);
    });
  });

  describe('getSlotCapacity', () => {
    it('is the minimum of qualified staff and active chairs (3 staff, 2 chairs -> 2)', async () => {
      prisma.staffService.count.mockResolvedValue(0);
      prisma.salonStaff.count.mockResolvedValue(3);
      prisma.chair.count.mockResolvedValue(2);
      await expect(
        service.getSlotCapacity(prisma as never, 's1', 'sv1'),
      ).resolves.toBe(2);
    });

    it('is the minimum of qualified staff and active chairs (2 staff, 3 chairs -> 2)', async () => {
      prisma.staffService.count.mockResolvedValue(0);
      prisma.salonStaff.count.mockResolvedValue(2);
      prisma.chair.count.mockResolvedValue(3);
      await expect(
        service.getSlotCapacity(prisma as never, 's1', 'sv1'),
      ).resolves.toBe(2);
    });
  });

  describe('getAvailability', () => {
    beforeEach(() => {
      prisma.salon.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE' });
      prisma.service.findFirst.mockResolvedValue({
        id: 'sv1',
        salonId: 's1',
        durationMinutes: 30,
        isActive: true,
      });
      prisma.staffService.count.mockResolvedValue(0);
      prisma.salonStaff.count.mockResolvedValue(2);
      prisma.chair.count.mockResolvedValue(2);
      prisma.booking.findMany.mockResolvedValue([]);
    });

    it('returns an empty list when the day is marked isClosed', async () => {
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '20:00',
        isClosed: true,
      });
      const slots = await service.getAvailability(
        's1',
        'sv1',
        futureDateString(2),
      );
      expect(slots).toEqual([]);
    });

    it('returns an empty list when no OperatingHours row exists for that day', async () => {
      prisma.operatingHours.findUnique.mockResolvedValue(null);
      const slots = await service.getAvailability(
        's1',
        'sv1',
        futureDateString(2),
      );
      expect(slots).toEqual([]);
    });

    it('returns an empty list for a date beyond the 30-day booking window', async () => {
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '20:00',
        isClosed: false,
      });
      const slots = await service.getAvailability(
        's1',
        'sv1',
        futureDateString(45),
      );
      expect(slots).toEqual([]);
    });

    it('generates 15-minute-granularity slots within a short operating window and marks them available', async () => {
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '10:00',
        isClosed: false,
      });
      const slots = await service.getAvailability(
        's1',
        'sv1',
        futureDateString(2),
      );
      // 09:00-10:00 window, 30 min service, 15 min granularity: 09:00, 09:15, 09:30 fit (09:45+30=10:15 doesn't).
      expect(slots).toHaveLength(3);
      expect(slots.every((s) => s.available)).toBe(true);
    });

    it('marks a slot unavailable once consumed capacity reaches the computed capacity', async () => {
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '10:00',
        isClosed: false,
      });
      const day = futureDateString(2);
      const [y, m, d] = day.split('-').map(Number);
      // Both existing bookings overlap the 09:00 candidate slot (IST 09:00 = 03:30 UTC).
      const slotStartUtc = new Date(Date.UTC(y, m - 1, d, 3, 30));
      const slotEndUtc = new Date(Date.UTC(y, m - 1, d, 4, 0));
      prisma.booking.findMany.mockResolvedValue([
        { slotStart: slotStartUtc, slotEnd: slotEndUtc },
        { slotStart: slotStartUtc, slotEnd: slotEndUtc },
      ]);
      const slots = await service.getAvailability('s1', 'sv1', day);
      const firstSlot = slots.find(
        (s) => s.slotStart === slotStartUtc.toISOString(),
      );
      expect(firstSlot?.available).toBe(false);
    });

    describe('with a specific staffId (Phase 7 — barber working hours)', () => {
      beforeEach(() => {
        prisma.salonStaff.findFirst.mockResolvedValue({ id: 'st1' });
        prisma.operatingHours.findUnique.mockResolvedValue({
          openTime: '09:00',
          closeTime: '18:00',
          isClosed: false,
        });
      });

      it('is unaffected by a barber with no configured working hours (unrestricted default)', async () => {
        prisma.staffWorkingHours.findUnique.mockResolvedValue(null);
        const slots = await service.getAvailability(
          's1',
          'sv1',
          futureDateString(2),
          'st1',
        );
        // Full 09:00-18:00 shop window, 30 min service, 15 min granularity.
        expect(slots.length).toBeGreaterThan(0);
        expect(slots[0].slotStart).toContain('T03:30'); // 09:00 IST = 03:30 UTC
      });

      it('clips the slot window to the intersection of shop hours and the barber\'s configured hours', async () => {
        prisma.staffWorkingHours.findUnique.mockResolvedValue({
          openTime: '11:00',
          closeTime: '13:00',
          isClosed: false,
        });
        const slots = await service.getAvailability(
          's1',
          'sv1',
          futureDateString(2),
          'st1',
        );
        expect(slots.length).toBeGreaterThan(0);
        // 11:00 IST = 05:30 UTC — the barber's own (narrower) window, not the shop's 09:00.
        expect(slots[0].slotStart).toContain('T05:30');
        expect(slots.every((s) => s.slotStart < `${futureDateString(2)}T07:31`)).toBe(true);
      });

      it('returns no slots when the barber is explicitly off that day', async () => {
        prisma.staffWorkingHours.findUnique.mockResolvedValue({
          openTime: '09:00',
          closeTime: '18:00',
          isClosed: true,
        });
        const slots = await service.getAvailability(
          's1',
          'sv1',
          futureDateString(2),
          'st1',
        );
        expect(slots).toEqual([]);
      });

      it('returns no slots when the barber\'s configured hours fall entirely outside shop hours', async () => {
        prisma.staffWorkingHours.findUnique.mockResolvedValue({
          openTime: '19:00',
          closeTime: '20:00',
          isClosed: false,
        });
        const slots = await service.getAvailability(
          's1',
          'sv1',
          futureDateString(2),
          'st1',
        );
        expect(slots).toEqual([]);
      });
    });
  });

  describe('assertStaffWithinWorkingHours', () => {
    it('is a no-op when the barber has no configured working hours', async () => {
      prisma.staffWorkingHours.findUnique.mockResolvedValue(null);
      const day = futureDateString(2);
      const [y, m, d] = day.split('-').map(Number);
      await expect(
        service.assertStaffWithinWorkingHours(
          'st1',
          new Date(Date.UTC(y, m - 1, d, 3, 30)),
          new Date(Date.UTC(y, m - 1, d, 4, 0)),
        ),
      ).resolves.toBeUndefined();
    });

    it('throws OUTSIDE_OPERATING_HOURS when the slot falls outside the barber\'s configured hours', async () => {
      prisma.staffWorkingHours.findUnique.mockResolvedValue({
        openTime: '11:00',
        closeTime: '13:00',
        isClosed: false,
      });
      const day = futureDateString(2);
      const [y, m, d] = day.split('-').map(Number);
      // 09:00 IST = 03:30 UTC — before the barber's 11:00 start.
      await expect(
        service.assertStaffWithinWorkingHours(
          'st1',
          new Date(Date.UTC(y, m - 1, d, 3, 30)),
          new Date(Date.UTC(y, m - 1, d, 4, 0)),
        ),
      ).rejects.toMatchObject({ code: 'OUTSIDE_OPERATING_HOURS' });
    });

    it('throws when the barber is marked off that day regardless of the requested time', async () => {
      prisma.staffWorkingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '18:00',
        isClosed: true,
      });
      const day = futureDateString(2);
      const [y, m, d] = day.split('-').map(Number);
      await expect(
        service.assertStaffWithinWorkingHours(
          'st1',
          new Date(Date.UTC(y, m - 1, d, 5, 30)),
          new Date(Date.UTC(y, m - 1, d, 6, 0)),
        ),
      ).rejects.toMatchObject({ code: 'OUTSIDE_OPERATING_HOURS' });
    });

    it('resolves when the slot falls within the barber\'s configured hours', async () => {
      prisma.staffWorkingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '18:00',
        isClosed: false,
      });
      const day = futureDateString(2);
      const [y, m, d] = day.split('-').map(Number);
      // 11:00 IST = 05:30 UTC — within 09:00-18:00.
      await expect(
        service.assertStaffWithinWorkingHours(
          'st1',
          new Date(Date.UTC(y, m - 1, d, 5, 30)),
          new Date(Date.UTC(y, m - 1, d, 6, 0)),
        ),
      ).resolves.toBeUndefined();
    });
  });
});
