import { Test } from '@nestjs/testing';
import { AvailabilityService } from './availability.service';
import { PrismaService } from '../prisma/prisma.service';

function futureDateString(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

interface PrismaMock {
  salon: { findUnique: jest.Mock<Promise<unknown>, [unknown]> };
  service: {
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
  };
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
  queueEntry: { findMany: jest.Mock<Promise<unknown[]>, [unknown]> };
}

describe('AvailabilityService', () => {
  let service: AvailabilityService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      salon: { findUnique: jest.fn<Promise<unknown>, [unknown]>() },
      service: {
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
        findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
      },
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
      queueEntry: { findMany: jest.fn<Promise<unknown[]>, [unknown]>() },
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

  describe('getRecentActivity', () => {
    beforeEach(() => {
      prisma.booking.findMany.mockResolvedValue([]);
      prisma.queueEntry.findMany.mockResolvedValue([]);
    });

    it('queries only CONFIRMED bookings created within the last 30 minutes for this salon', async () => {
      await service.getRecentActivity('s1');
      const call = prisma.booking.findMany.mock.calls[0][0] as {
        where: { salonId: string; status: string; createdAt: { gte: Date } };
      };
      expect(call.where.salonId).toBe('s1');
      expect(call.where.status).toBe('CONFIRMED');
      expect(Date.now() - call.where.createdAt.gte.getTime()).toBeCloseTo(
        30 * 60_000,
        -3,
      );
    });

    it('merges bookings and queue joins, most recent first, anonymized (no name field anywhere)', async () => {
      const now = Date.now();
      prisma.booking.findMany.mockResolvedValue([
        {
          createdAt: new Date(now - 5 * 60_000),
          service: { name: 'Haircut' },
        },
      ]);
      prisma.queueEntry.findMany.mockResolvedValue([
        {
          joinedAt: new Date(now - 2 * 60_000),
          service: { name: 'Beard' },
        },
      ]);
      const result = await service.getRecentActivity('s1');
      expect(result).toEqual([
        {
          type: 'queue',
          serviceName: 'Beard',
          occurredAt: new Date(now - 2 * 60_000).toISOString(),
        },
        {
          type: 'booking',
          serviceName: 'Haircut',
          occurredAt: new Date(now - 5 * 60_000).toISOString(),
        },
      ]);
      // toEqual above already pins the exact shape (type/serviceName/occurredAt only) — no
      // customer name, phone, or email field exists on this DTO at all.
    });

    it('handles a walk-in queue join with no service chosen (serviceName null, not a crash)', async () => {
      prisma.queueEntry.findMany.mockResolvedValue([
        { joinedAt: new Date(), service: null },
      ]);
      const result = await service.getRecentActivity('s1');
      expect(result[0].serviceName).toBeNull();
    });

    it('returns an empty list — not an error — when there is genuinely no recent activity', async () => {
      await expect(service.getRecentActivity('s1')).resolves.toEqual([]);
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
      prisma.service.findMany.mockResolvedValue([{ id: 'sv1', salonId: 's1', isActive: true }]);
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
      // India fallback resolves to Asia/Kolkata (+05:30, no DST) — every existing "09:00 IST =
      // 03:30 UTC"-style assertion below stays valid as-is; see the dedicated timezone describe
      // block further down for non-India/DST/unknown-zone coverage of this same method.
      prisma.salon.findUnique.mockResolvedValue({
        id: 's1',
        status: 'ACTIVE',
        timezone: null,
        city: { countryCode: 'IN' },
      });
      prisma.service.findFirst.mockResolvedValue({
        id: 'sv1',
        salonId: 's1',
        durationMinutes: 30,
        isActive: true,
      });
      // getAvailability loads its service(s) via getServicesOrThrow (service.findMany) — the
      // findFirst mock above is unused by getAvailability itself, kept only in case a test in this
      // block also exercises getServiceOrThrow directly.
      prisma.service.findMany.mockResolvedValue([
        { id: 'sv1', salonId: 's1', name: 'Haircut', durationMinutes: 30, isActive: true },
      ]);
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
        ['sv1'],
        futureDateString(2),
      );
      expect(slots).toEqual([]);
    });

    it('returns an empty list when no OperatingHours row exists for that day', async () => {
      prisma.operatingHours.findUnique.mockResolvedValue(null);
      const slots = await service.getAvailability(
        's1',
        ['sv1'],
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
        ['sv1'],
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
        ['sv1'],
        futureDateString(2),
      );
      // 09:00-10:00 window, 30 min service, 15 min granularity: 09:00, 09:15, 09:30 fit (09:45+30=10:15 doesn't).
      expect(slots).toHaveLength(3);
      expect(slots.every((s) => s.available)).toBe(true);
      expect(slots.every((s) => s.state === 'AVAILABLE')).toBe(true);
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
      const slots = await service.getAvailability('s1', ['sv1'], day);
      const firstSlot = slots.find(
        (s) => s.slotStart === slotStartUtc.toISOString(),
      );
      expect(firstSlot?.available).toBe(false);
      expect(firstSlot?.state).toBe('OCCUPIED');
    });

    it('marks every candidate that overlaps a longer appointment as occupied', async () => {
      prisma.service.findMany.mockResolvedValue([
        { id: 'sv1', salonId: 's1', name: 'Haircut', durationMinutes: 45, isActive: true },
      ]);
      prisma.salonStaff.count.mockResolvedValue(1);
      prisma.chair.count.mockResolvedValue(1);
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '10:00',
        closeTime: '12:00',
        isClosed: false,
      });
      const day = futureDateString(2);
      const [y, m, d] = day.split('-').map(Number);
      // 10:00–10:45 IST. A 45-minute service starting at 10:00, 10:15, or 10:30
      // intersects this appointment and must be unavailable for the one-chair salon.
      const bookedStart = new Date(Date.UTC(y, m - 1, d, 4, 30));
      const bookedEnd = new Date(Date.UTC(y, m - 1, d, 5, 15));
      prisma.booking.findMany.mockResolvedValue([
        { slotStart: bookedStart, slotEnd: bookedEnd },
      ]);

      const slots = await service.getAvailability('s1', ['sv1'], day);
      expect(
        slots.find((slot) => slot.slotStart === bookedStart.toISOString()),
      ).toMatchObject({
        available: false,
        state: 'OCCUPIED',
      });
      expect(
        slots.find(
          (slot) =>
            slot.slotStart ===
            new Date(bookedStart.getTime() + 15 * 60_000).toISOString(),
        ),
      ).toMatchObject({
        available: false,
        state: 'OCCUPIED',
      });
      expect(
        slots.find(
          (slot) =>
            slot.slotStart ===
            new Date(bookedStart.getTime() + 30 * 60_000).toISOString(),
        ),
      ).toMatchObject({
        available: false,
        state: 'OCCUPIED',
      });
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
          ['sv1'],
          futureDateString(2),
          'st1',
        );
        // Full 09:00-18:00 shop window, 30 min service, 15 min granularity.
        expect(slots.length).toBeGreaterThan(0);
        expect(slots[0].slotStart).toContain('T03:30'); // 09:00 IST = 03:30 UTC
      });

      it("clips the slot window to the intersection of shop hours and the barber's configured hours", async () => {
        prisma.staffWorkingHours.findUnique.mockResolvedValue({
          openTime: '11:00',
          closeTime: '13:00',
          isClosed: false,
        });
        const slots = await service.getAvailability(
          's1',
          ['sv1'],
          futureDateString(2),
          'st1',
        );
        expect(slots.length).toBeGreaterThan(0);
        // 11:00 IST = 05:30 UTC — the barber's own (narrower) window, not the shop's 09:00.
        expect(slots[0].slotStart).toContain('T05:30');
        expect(
          slots.every((s) => s.slotStart < `${futureDateString(2)}T07:31`),
        ).toBe(true);
      });

      it('returns no slots when the barber is explicitly off that day', async () => {
        prisma.staffWorkingHours.findUnique.mockResolvedValue({
          openTime: '09:00',
          closeTime: '18:00',
          isClosed: true,
        });
        const slots = await service.getAvailability(
          's1',
          ['sv1'],
          futureDateString(2),
          'st1',
        );
        expect(slots).toEqual([]);
      });

      it("returns no slots when the barber's configured hours fall entirely outside shop hours", async () => {
        prisma.staffWorkingHours.findUnique.mockResolvedValue({
          openTime: '19:00',
          closeTime: '20:00',
          isClosed: false,
        });
        const slots = await service.getAvailability(
          's1',
          ['sv1'],
          futureDateString(2),
          'st1',
        );
        expect(slots).toEqual([]);
      });

      it('marks a slot occupied for this specific barber even though the salon-wide pool has spare capacity', async () => {
        prisma.staffWorkingHours.findUnique.mockResolvedValue(null);
        prisma.salonStaff.count.mockResolvedValue(5); // plenty of pool capacity
        prisma.chair.count.mockResolvedValue(5);
        const day = futureDateString(2);
        const [y, m, d] = day.split('-').map(Number);
        const slotStartUtc = new Date(Date.UTC(y, m - 1, d, 3, 30)); // 09:00 IST
        const slotEndUtc = new Date(Date.UTC(y, m - 1, d, 4, 0));
        prisma.booking.findMany.mockResolvedValue([
          {
            slotStart: slotStartUtc,
            slotEnd: slotEndUtc,
            preferredStaffId: 'st1',
          },
        ]);
        const slots = await service.getAvailability('s1', ['sv1'], day, 'st1');
        const slot = slots.find(
          (s) => s.slotStart === slotStartUtc.toISOString(),
        );
        expect(slot).toMatchObject({ available: false, state: 'OCCUPIED' });
      });

      it('a DIFFERENT staff member remains available for the exact same overlapping slot (pool capacity, not staff-specific)', async () => {
        prisma.staffWorkingHours.findUnique.mockResolvedValue(null);
        prisma.salonStaff.findFirst.mockResolvedValue({ id: 'st2' });
        prisma.salonStaff.count.mockResolvedValue(5);
        prisma.chair.count.mockResolvedValue(5);
        const day = futureDateString(2);
        const [y, m, d] = day.split('-').map(Number);
        const slotStartUtc = new Date(Date.UTC(y, m - 1, d, 3, 30));
        const slotEndUtc = new Date(Date.UTC(y, m - 1, d, 4, 0));
        prisma.booking.findMany.mockResolvedValue([
          {
            slotStart: slotStartUtc,
            slotEnd: slotEndUtc,
            preferredStaffId: 'st1',
          },
        ]);
        const slots = await service.getAvailability('s1', ['sv1'], day, 'st2');
        const slot = slots.find(
          (s) => s.slotStart === slotStartUtc.toISOString(),
        );
        expect(slot).toMatchObject({ available: true, state: 'AVAILABLE' });
      });

      it('"Any Staff" (no staffId) is unaffected by a specific barber being taken — pool capacity alone governs it', async () => {
        prisma.salonStaff.count.mockResolvedValue(5);
        prisma.chair.count.mockResolvedValue(5);
        prisma.operatingHours.findUnique.mockResolvedValue({
          openTime: '09:00',
          closeTime: '18:00',
          isClosed: false,
        });
        const day = futureDateString(2);
        const [y, m, d] = day.split('-').map(Number);
        const slotStartUtc = new Date(Date.UTC(y, m - 1, d, 3, 30));
        const slotEndUtc = new Date(Date.UTC(y, m - 1, d, 4, 0));
        prisma.booking.findMany.mockResolvedValue([
          {
            slotStart: slotStartUtc,
            slotEnd: slotEndUtc,
            preferredStaffId: 'st1',
          },
        ]);
        const slots = await service.getAvailability('s1', ['sv1'], day);
        const slot = slots.find(
          (s) => s.slotStart === slotStartUtc.toISOString(),
        );
        expect(slot).toMatchObject({ available: true, state: 'AVAILABLE' });
      });
    });
  });

  // Multi-service booking core mission — the P0 scheduling flaw this mission fixes: a single-chair
  // shop must not show 9:15/9:30/9:45 as available when the customer has already selected 80
  // minutes of combined services starting at 9:00. Cases numbered per the mission's own test plan.
  describe('multi-service booking core mission — availability', () => {
    function threeServiceCatalog() {
      // 30 + 20 + 30 = 80 minutes combined, matching the mission's own worked example exactly.
      return [
        { id: 'svA', salonId: 's1', name: 'Haircut', durationMinutes: 30, isActive: true },
        { id: 'svB', salonId: 's1', name: 'Beard Trim', durationMinutes: 20, isActive: true },
        { id: 'svC', salonId: 's1', name: 'Facial', durationMinutes: 30, isActive: true },
      ];
    }

    beforeEach(() => {
      prisma.salon.findUnique.mockResolvedValue({
        id: 's1',
        status: 'ACTIVE',
        timezone: null,
        city: { countryCode: 'IN' },
      });
      prisma.staffService.count.mockResolvedValue(0); // every ACTIVE staff qualifies, by default
    });

    it('CASE 1: a single-chair shop hides every slot overlapping an existing 60-minute appointment for an 80-minute combined selection, and the first fully-clear slot is available', async () => {
      prisma.service.findMany.mockResolvedValue(threeServiceCatalog());
      prisma.salonStaff.count.mockResolvedValue(2); // staff is not the bottleneck
      prisma.chair.count.mockResolvedValue(1); // exactly one chair
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '11:30',
        isClosed: false,
      });
      const day = futureDateString(2);
      const [y, m, d] = day.split('-').map(Number);
      // 09:00-10:00 IST = 03:30-04:30 UTC — a real existing 60-minute appointment.
      const existingStart = new Date(Date.UTC(y, m - 1, d, 3, 30));
      const existingEnd = new Date(Date.UTC(y, m - 1, d, 4, 30));
      prisma.booking.findMany.mockResolvedValue([
        { slotStart: existingStart, slotEnd: existingEnd },
      ]);

      const slots = await service.getAvailability('s1', ['svA', 'svB', 'svC'], day);
      const byStart = new Map(slots.map((s) => [s.slotStart, s]));
      const at = (hh: number, mm: number) =>
        byStart.get(new Date(Date.UTC(y, m - 1, d, hh - 5, mm - 30)).toISOString());
      // 09:15, 09:30, 09:45 all produce an 80-minute candidate interval that overlaps the existing
      // 09:00-10:00 appointment (e.g. 09:15-10:35 overlaps 09:00-10:00) — every one unavailable.
      expect(at(9, 15)).toMatchObject({ available: false, state: 'OCCUPIED' });
      expect(at(9, 30)).toMatchObject({ available: false, state: 'OCCUPIED' });
      expect(at(9, 45)).toMatchObject({ available: false, state: 'OCCUPIED' });
      // 10:00-11:20 does not overlap the existing 09:00-10:00 appointment at all -> available.
      expect(at(10, 0)).toMatchObject({ available: true, state: 'AVAILABLE' });
    });

    it('CASE 2: the candidate slotEnd is exactly slotStart + the sum of every selected service duration (30+20+30=80)', async () => {
      prisma.service.findMany.mockResolvedValue(threeServiceCatalog());
      prisma.salonStaff.count.mockResolvedValue(2);
      prisma.chair.count.mockResolvedValue(2);
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '12:00',
        isClosed: false,
      });
      prisma.booking.findMany.mockResolvedValue([]);
      const day = futureDateString(2);
      const slots = await service.getAvailability('s1', ['svA', 'svB', 'svC'], day);
      expect(slots.length).toBeGreaterThan(0);
      for (const slot of slots) {
        expect(new Date(slot.slotEnd).getTime() - new Date(slot.slotStart).getTime()).toBe(
          80 * 60_000,
        );
      }
    });

    it('CASE 3: adding a service to the selection changes which slots are available (a slot valid for one service can become invalid for the combined selection)', async () => {
      const day = futureDateString(2);
      const [y, m, d] = day.split('-').map(Number);
      prisma.salonStaff.count.mockResolvedValue(1);
      prisma.chair.count.mockResolvedValue(1);
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '10:00',
        isClosed: false,
      });
      // A second, unrelated appointment sits at 09:45-10:00 (IST) — irrelevant to a short single
      // 30-minute service starting at 09:00, but it collides with a longer combined selection.
      const blockStart = new Date(Date.UTC(y, m - 1, d, 4, 15));
      const blockEnd = new Date(Date.UTC(y, m - 1, d, 4, 30));
      prisma.booking.findMany.mockResolvedValue([{ slotStart: blockStart, slotEnd: blockEnd }]);

      prisma.service.findMany.mockResolvedValue([threeServiceCatalog()[0]]); // svA alone, 30 min
      const singleServiceSlots = await service.getAvailability('s1', ['svA'], day);
      const singleAt9 = singleServiceSlots.find((s) => s.slotStart === new Date(Date.UTC(y, m - 1, d, 3, 30)).toISOString());
      expect(singleAt9).toMatchObject({ available: true }); // 09:00-09:30 never touches 09:45-10:00

      prisma.service.findMany.mockResolvedValue(threeServiceCatalog()); // svA+svB+svC, 80 min
      const combinedSlots = await service.getAvailability('s1', ['svA', 'svB', 'svC'], day);
      // The 09:00-10:00 window can't even fit an 80-minute appointment at all (closes at 10:00) —
      // adding services didn't just shrink availability, the entire day now has no valid slot,
      // proving the selection genuinely drives what's computed, not a client-side filter.
      expect(combinedSlots).toEqual([]);
    });

    it('CASE 4: a candidate interval crossing salon closing time never appears as a slot at all', async () => {
      prisma.service.findMany.mockResolvedValue(threeServiceCatalog()); // 80 minutes
      prisma.salonStaff.count.mockResolvedValue(2);
      prisma.chair.count.mockResolvedValue(2);
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '10:00', // only 60 minutes of window — cannot fit an 80-minute appointment
        isClosed: false,
      });
      prisma.booking.findMany.mockResolvedValue([]);
      const slots = await service.getAvailability('s1', ['svA', 'svB', 'svC'], futureDateString(2));
      expect(slots).toEqual([]);
    });

    it('CASE 6: "Any Staff" requires ONE barber qualified for every selected service — three different barbers each qualified for only one service must not count as available', async () => {
      // Every service HAS restrictive StaffService rows (count > 0), and no single staff member
      // holds a qualification row for more than one of the three services.
      prisma.staffService.count.mockResolvedValue(1);
      prisma.service.findMany.mockResolvedValue(threeServiceCatalog());
      prisma.chair.count.mockResolvedValue(5); // chairs are plentiful; staff qualification is the constraint
      // qualifiedStaffWhereForServices issues one salonStaff.count per AND-ed where clause in
      // production, but this test only needs the OUTER count() this mock stands in for: zero staff
      // satisfy "qualified for svA AND svB AND svC" since each barber only qualifies for one.
      prisma.salonStaff.count.mockResolvedValue(0);
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '12:00',
        isClosed: false,
      });
      prisma.booking.findMany.mockResolvedValue([]);
      const slots = await service.getAvailability('s1', ['svA', 'svB', 'svC'], futureDateString(2));
      // Capacity is min(0 qualified staff, 5 chairs) = 0 -> nothing is ever bookable.
      expect(slots.every((s) => !s.available)).toBe(true);
      expect(slots.length).toBeGreaterThan(0); // slots exist (the window fits 80 min); none bookable
    });

    it('CASE 6b: qualifiedStaffWhereForServices ANDs one where-clause per restricted service, never a single OR-based "in" match', async () => {
      prisma.staffService.count.mockResolvedValue(1);
      const where = await service.qualifiedStaffWhereForServices(
        prisma as never,
        's1',
        ['svA', 'svB', 'svC'],
      );
      expect(where.AND).toHaveLength(3);
      const services = (where.AND as { services: { some: { serviceId: string } } }[]).map(
        (clause) => clause.services.some.serviceId,
      );
      expect(services.sort()).toEqual(['svA', 'svB', 'svC']);
    });

    it('CASE 7: with 2 chairs and sufficient qualified staff, a legitimate overlapping appointment is allowed', async () => {
      prisma.service.findMany.mockResolvedValue([threeServiceCatalog()[0]]); // single 30-min service
      prisma.staffService.count.mockResolvedValue(0); // unrestricted
      prisma.salonStaff.count.mockResolvedValue(2);
      prisma.chair.count.mockResolvedValue(2);
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '11:00',
        isClosed: false,
      });
      const day = futureDateString(2);
      const [y, m, d] = day.split('-').map(Number);
      const existingStart = new Date(Date.UTC(y, m - 1, d, 3, 30)); // 09:00 IST
      const existingEnd = new Date(Date.UTC(y, m - 1, d, 4, 0)); // 09:30 IST
      prisma.booking.findMany.mockResolvedValue([{ slotStart: existingStart, slotEnd: existingEnd }]);

      const slots = await service.getAvailability('s1', ['svA'], day);
      const at915 = slots.find((s) => s.slotStart === new Date(Date.UTC(y, m - 1, d, 3, 45)).toISOString());
      // Capacity 2 (min(2 staff, 2 chairs)), only 1 overlapping booking -> isSlotBookable(2,1)=true.
      expect(at915).toMatchObject({ available: true, state: 'AVAILABLE' });
    });
  });

  describe('assertStaffWithinWorkingHours', () => {
    beforeEach(() => {
      prisma.salon.findUnique.mockResolvedValue({
        timezone: null,
        city: { countryCode: 'IN' },
      });
    });

    it('is a no-op when the barber has no configured working hours', async () => {
      prisma.staffWorkingHours.findUnique.mockResolvedValue(null);
      const day = futureDateString(2);
      const [y, m, d] = day.split('-').map(Number);
      await expect(
        service.assertStaffWithinWorkingHours(
          's1',
          'st1',
          new Date(Date.UTC(y, m - 1, d, 3, 30)),
          new Date(Date.UTC(y, m - 1, d, 4, 0)),
        ),
      ).resolves.toBeUndefined();
    });

    it("throws OUTSIDE_OPERATING_HOURS when the slot falls outside the barber's configured hours", async () => {
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
          's1',
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
          's1',
          'st1',
          new Date(Date.UTC(y, m - 1, d, 5, 30)),
          new Date(Date.UTC(y, m - 1, d, 6, 0)),
        ),
      ).rejects.toMatchObject({ code: 'OUTSIDE_OPERATING_HOURS' });
    });

    it("resolves when the slot falls within the barber's configured hours", async () => {
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
          's1',
          'st1',
          new Date(Date.UTC(y, m - 1, d, 5, 30)),
          new Date(Date.UTC(y, m - 1, d, 6, 0)),
        ),
      ).resolves.toBeUndefined();
    });

    it('throws SALON_TIMEZONE_REQUIRED when the salon has no resolvable timezone', async () => {
      prisma.salon.findUnique.mockResolvedValue({
        timezone: null,
        city: { countryCode: 'US' },
      });
      const day = futureDateString(2);
      const [y, m, d] = day.split('-').map(Number);
      await expect(
        service.assertStaffWithinWorkingHours(
          's1',
          'st1',
          new Date(Date.UTC(y, m - 1, d, 5, 30)),
          new Date(Date.UTC(y, m - 1, d, 6, 0)),
        ),
      ).rejects.toMatchObject({ code: 'SALON_TIMEZONE_REQUIRED' });
    });
  });

  // Required timezone coverage (non-India zone, DST transition, missing timezone) beyond what
  // timezone.spec.ts already covers in isolation — these prove AvailabilityService actually uses
  // the salon's OWN resolved zone end-to-end, not a hardcoded IST assumption anywhere in between.
  describe('timezone correctness (global salons — not India-only)', () => {
    beforeEach(() => {
      prisma.service.findFirst.mockResolvedValue({
        id: 'sv1',
        salonId: 's1',
        durationMinutes: 30,
        isActive: true,
      });
      // getAvailability loads its service(s) via getServicesOrThrow (service.findMany) — the
      // findFirst mock above is unused by getAvailability itself, kept only in case a test in this
      // block also exercises getServiceOrThrow directly.
      prisma.service.findMany.mockResolvedValue([
        { id: 'sv1', salonId: 's1', name: 'Haircut', durationMinutes: 30, isActive: true },
      ]);
      prisma.staffService.count.mockResolvedValue(0);
      prisma.salonStaff.count.mockResolvedValue(2);
      prisma.chair.count.mockResolvedValue(2);
      prisma.booking.findMany.mockResolvedValue([]);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('honours an explicit non-India IANA timezone (Europe/London) rather than defaulting to IST', async () => {
      // "Now" pinned within the 30-day booking window of the requested (BST) date.
      jest.useFakeTimers({ now: new Date('2026-06-25T00:00:00.000Z') });
      prisma.salon.findUnique.mockResolvedValue({
        id: 's1',
        status: 'ACTIVE',
        timezone: 'Europe/London',
        city: { countryCode: 'GB' },
      });
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '10:00',
        isClosed: false,
      });
      // A summer date: 09:00 London (BST, +01:00) = 08:00 UTC — NOT 03:30 UTC, which is what the
      // old fixed +05:30 IST assumption would have produced for this same wall-clock time.
      const slots = await service.getAvailability('s1', ['sv1'], '2026-07-01');
      expect(slots.length).toBeGreaterThan(0);
      expect(slots[0].slotStart).toBe('2026-07-01T08:00:00.000Z');
    });

    it('applies the correct offset across a DST transition for the same salon', async () => {
      // "Now" pinned within the 30-day booking window of the requested (GMT) date — a separate
      // fake-clock window from the BST test above, since the two seasons are ~6 months apart and
      // MAX_BOOKING_DAYS_AHEAD is only 30 days.
      jest.useFakeTimers({ now: new Date('2026-01-05T00:00:00.000Z') });
      prisma.salon.findUnique.mockResolvedValue({
        id: 's1',
        status: 'ACTIVE',
        timezone: 'Europe/London',
        city: { countryCode: 'GB' },
      });
      prisma.operatingHours.findUnique.mockResolvedValue({
        openTime: '09:00',
        closeTime: '10:00',
        isClosed: false,
      });
      // A winter date: 09:00 London (GMT, +00:00) = 09:00 UTC.
      const slots = await service.getAvailability('s1', ['sv1'], '2026-01-15');
      expect(slots.length).toBeGreaterThan(0);
      expect(slots[0].slotStart).toBe('2026-01-15T09:00:00.000Z');
    });

    it('throws SALON_TIMEZONE_REQUIRED — never silently falls back to IST — for a salon with no timezone and a non-India city', async () => {
      prisma.salon.findUnique.mockResolvedValue({
        id: 's1',
        status: 'ACTIVE',
        timezone: null,
        city: { countryCode: 'US' },
      });
      await expect(
        service.getAvailability('s1', ['sv1'], futureDateString(2)),
      ).rejects.toMatchObject({ code: 'SALON_TIMEZONE_REQUIRED' });
    });

    it('throws SALON_TIMEZONE_REQUIRED for an invalid stored IANA timezone string, not a crash', async () => {
      prisma.salon.findUnique.mockResolvedValue({
        id: 's1',
        status: 'ACTIVE',
        timezone: 'Not/AZone',
        city: { countryCode: 'US' },
      });
      await expect(
        service.getAvailability('s1', ['sv1'], futureDateString(2)),
      ).rejects.toMatchObject({ code: 'SALON_TIMEZONE_REQUIRED' });
    });
  });
});
