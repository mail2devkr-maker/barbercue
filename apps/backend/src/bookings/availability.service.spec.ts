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
  });
});
