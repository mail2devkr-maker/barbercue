import { AppException } from '../common/exceptions/app.exception';
import { SalonTimezoneService } from './salon-timezone.service';

describe('SalonTimezoneService', () => {
  let service: SalonTimezoneService;
  let prisma: {
    salon: { findUnique: jest.Mock; update: jest.Mock };
  };
  let salonAccess: { assertOwnerAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      salon: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'salon-1', timezone: null }),
        update: jest
          .fn()
          .mockResolvedValue({ id: 'salon-1', timezone: 'Asia/Kolkata' }),
      },
    };
    salonAccess = { assertOwnerAccess: jest.fn().mockResolvedValue(undefined) };
    service = new SalonTimezoneService(prisma as never, salonAccess as never);
  });

  describe('getTimezone', () => {
    it('checks salon access first, then returns the current value', async () => {
      const result = await service.getTimezone('owner-1', 'salon-1');
      expect(salonAccess.assertOwnerAccess).toHaveBeenCalledWith(
        'owner-1',
        'salon-1',
      );
      expect(result).toEqual({ id: 'salon-1', timezone: null });
    });

    it('throws SALON_NOT_FOUND for a salon that does not exist', async () => {
      prisma.salon.findUnique.mockResolvedValue(null);
      await expect(
        service.getTimezone('owner-1', 'missing-salon'),
      ).rejects.toThrow(AppException);
    });
  });

  describe('updateTimezone', () => {
    it('saves a real IANA zone', async () => {
      const result = await service.updateTimezone('owner-1', 'salon-1', {
        timezone: 'Asia/Kolkata',
      });
      expect(prisma.salon.update).toHaveBeenCalledWith({
        where: { id: 'salon-1' },
        data: { timezone: 'Asia/Kolkata' },
        select: { id: true, timezone: true },
      });
      expect(result).toEqual({ id: 'salon-1', timezone: 'Asia/Kolkata' });
    });

    it('saves a real non-India zone just as validly — never assumes India', async () => {
      prisma.salon.update.mockResolvedValue({
        id: 'salon-1',
        timezone: 'America/New_York',
      });
      const result = await service.updateTimezone('owner-1', 'salon-1', {
        timezone: 'America/New_York',
      });
      expect(result.timezone).toBe('America/New_York');
    });

    it('rejects a string that is not a real IANA zone name, even if it looks plausible', async () => {
      // Passes the shared schema's shape regex ("Area/Location") but Intl doesn't recognize it —
      // exactly the gap the schema's own doc comment says this service method has to close.
      await expect(
        service.updateTimezone('owner-1', 'salon-1', {
          timezone: 'Fake/Nowhere',
        }),
      ).rejects.toThrow(AppException);
      expect(prisma.salon.update).not.toHaveBeenCalled();
    });

    it('checks salon access before touching the database', async () => {
      salonAccess.assertOwnerAccess.mockRejectedValue(new Error('denied'));
      await expect(
        service.updateTimezone('owner-1', 'salon-1', {
          timezone: 'Asia/Kolkata',
        }),
      ).rejects.toThrow('denied');
      expect(prisma.salon.update).not.toHaveBeenCalled();
    });

    it('throws SALON_NOT_FOUND for a salon that does not exist', async () => {
      prisma.salon.findUnique.mockResolvedValue(null);
      await expect(
        service.updateTimezone('owner-1', 'missing-salon', {
          timezone: 'Asia/Kolkata',
        }),
      ).rejects.toThrow(AppException);
    });
  });
});
