import { AppException } from '../common/exceptions/app.exception';
import { SalonTimezoneService } from './salon-timezone.service';

describe('SalonTimezoneService', () => {
  let service: SalonTimezoneService;
  let prisma: {
    salon: { findUnique: jest.Mock; update: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  let salonAccess: { assertOwnerOrAdminAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      salon: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'salon-1',
          timezone: null,
          timezoneAutoDetected: false,
          timezoneManuallyOverridden: false,
          lat: null,
          lng: null,
          city: { countryCode: 'IN', timezone: null },
        }),
        update: jest.fn().mockResolvedValue({
          id: 'salon-1',
          timezone: 'Asia/Kolkata',
          timezoneAutoDetected: false,
          timezoneManuallyOverridden: true,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    salonAccess = { assertOwnerOrAdminAccess: jest.fn().mockResolvedValue('OWNER') };
    service = new SalonTimezoneService(prisma as never, salonAccess as never);
  });

  describe('getTimezone', () => {
    it('checks salon access first, then returns the current value plus an India country-fallback suggestion', async () => {
      const result = await service.getTimezone('owner-1', 'salon-1');
      expect(salonAccess.assertOwnerOrAdminAccess).toHaveBeenCalledWith(
        'owner-1',
        'salon-1',
      );
      expect(result).toEqual({
        id: 'salon-1',
        timezone: null,
        countryCode: 'IN',
        timezoneAutoDetected: false,
        timezoneManuallyOverridden: false,
        suggestion: { timezone: 'Asia/Kolkata', confidence: 'HIGH', source: 'country' },
      });
    });

    it('suggests from GPS coordinates when present, even for a non-India salon', async () => {
      prisma.salon.findUnique.mockResolvedValue({
        id: 'salon-2',
        timezone: null,
        timezoneAutoDetected: false,
        timezoneManuallyOverridden: false,
        lat: 32.7767,
        lng: -96.797, // Dallas
        city: { countryCode: 'US', timezone: null },
      });
      const result = await service.getTimezone('owner-1', 'salon-2');
      expect(result.suggestion).toEqual({
        timezone: 'America/Chicago',
        confidence: 'EXACT',
        source: 'coordinates',
      });
    });

    it('returns a null suggestion when nothing confidently resolves — never fabricates one', async () => {
      prisma.salon.findUnique.mockResolvedValue({
        id: 'salon-3',
        timezone: null,
        timezoneAutoDetected: false,
        timezoneManuallyOverridden: false,
        lat: null,
        lng: null,
        city: { countryCode: 'US', timezone: null },
      });
      const result = await service.getTimezone('owner-1', 'salon-3');
      expect(result.suggestion).toBeNull();
    });

    it('still offers a suggestion even when a timezone is already stored, without touching it', async () => {
      prisma.salon.findUnique.mockResolvedValue({
        id: 'salon-4',
        timezone: 'Asia/Kolkata',
        timezoneAutoDetected: true,
        timezoneManuallyOverridden: false,
        lat: null,
        lng: null,
        city: { countryCode: 'IN', timezone: null },
      });
      const result = await service.getTimezone('owner-1', 'salon-4');
      expect(result.timezone).toBe('Asia/Kolkata');
      expect(result.suggestion).toEqual({
        timezone: 'Asia/Kolkata',
        confidence: 'HIGH',
        source: 'country',
      });
    });

    it('throws SALON_NOT_FOUND for a salon that does not exist', async () => {
      prisma.salon.findUnique.mockResolvedValue(null);
      await expect(
        service.getTimezone('owner-1', 'missing-salon'),
      ).rejects.toThrow(AppException);
    });
  });

  describe('updateTimezone', () => {
    it('saves a real IANA zone and marks it as a manual, non-auto-detected choice', async () => {
      const result = await service.updateTimezone('owner-1', 'salon-1', {
        timezone: 'Asia/Kolkata',
      });
      expect(prisma.salon.update).toHaveBeenCalledWith({
        where: { id: 'salon-1' },
        data: {
          timezone: 'Asia/Kolkata',
          timezoneAutoDetected: false,
          timezoneManuallyOverridden: true,
        },
        select: {
          id: true,
          timezone: true,
          timezoneAutoDetected: true,
          timezoneManuallyOverridden: true,
        },
      });
      expect(result).toEqual({
        id: 'salon-1',
        timezone: 'Asia/Kolkata',
        timezoneAutoDetected: false,
        timezoneManuallyOverridden: true,
        countryCode: 'IN',
        suggestion: { timezone: 'Asia/Kolkata', confidence: 'HIGH', source: 'country' },
      });
    });

    // Part 4, section 5: once the owner has explicitly chosen a value, a later render/refresh —
    // or another PATCH with the exact same explicit value — must never be treated as anything
    // other than an authoritative manual choice; it should never flip back to "auto-detected".
    it('a second explicit PATCH keeps timezoneManuallyOverridden true and timezoneAutoDetected false', async () => {
      prisma.salon.findUnique.mockResolvedValue({
        id: 'salon-1',
        timezone: 'Asia/Kolkata',
        timezoneAutoDetected: true, // was auto-filled at registration
        timezoneManuallyOverridden: false,
        lat: null,
        lng: null,
        city: { countryCode: 'IN', timezone: null },
      });
      await service.updateTimezone('owner-1', 'salon-1', { timezone: 'America/New_York' });
      expect(prisma.salon.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timezone: 'America/New_York',
            timezoneAutoDetected: false,
            timezoneManuallyOverridden: true,
          }),
        }),
      );
    });

    it('saves a real non-India zone just as validly — never assumes India', async () => {
      prisma.salon.update.mockResolvedValue({
        id: 'salon-1',
        timezone: 'America/New_York',
        timezoneAutoDetected: false,
        timezoneManuallyOverridden: true,
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
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValue(new Error('denied'));
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

    it('an owner update never writes an AuditLog row', async () => {
      await service.updateTimezone('owner-1', 'salon-1', { timezone: 'Asia/Kolkata' });
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    // Part 2 — PLATFORM_ADMIN delegated shop management.
    it('PLATFORM_ADMIN managing an ACTIVE salon succeeds and writes an AuditLog row naming the real admin actor', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValue('PLATFORM_ADMIN');
      const result = await service.updateTimezone('admin-1', 'salon-1', {
        timezone: 'Asia/Kolkata',
      });
      expect(result.timezone).toBe('Asia/Kolkata');
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'ADMIN_SALON_TIMEZONE_UPDATED',
          entityType: 'Salon',
          entityId: 'salon-1',
          metadata: expect.objectContaining({ field: 'timezone', after: 'Asia/Kolkata' }),
        }),
      });
    });
  });
});
