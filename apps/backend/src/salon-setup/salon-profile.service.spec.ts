import { SalonProfileService } from './salon-profile.service';

const SALON_ROW = {
  name: 'Original Name',
  phone: '+919876543210',
  email: 'shop@example.com',
  addressLine: '12 Example Road',
  postalCode: '560001',
  description: 'A great shop.',
  city: { countryCode: 'IN' },
};

describe('SalonProfileService', () => {
  let service: SalonProfileService;
  let prisma: {
    salon: { findUnique: jest.Mock; update: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  let salonAccess: { assertOwnerOrAdminAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      salon: {
        findUnique: jest.fn().mockResolvedValue(SALON_ROW),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'salon-1',
            name: SALON_ROW.name,
            phone: SALON_ROW.phone,
            email: SALON_ROW.email,
            addressLine: SALON_ROW.addressLine,
            postalCode: SALON_ROW.postalCode,
            description: SALON_ROW.description,
            ...data,
          }),
        ),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    salonAccess = { assertOwnerOrAdminAccess: jest.fn().mockResolvedValue('OWNER') };
    service = new SalonProfileService(prisma as never, salonAccess as never);
  });

  describe('get', () => {
    it('checks salon access before reading', async () => {
      await service.get('owner-1', 'salon-1');
      expect(salonAccess.assertOwnerOrAdminAccess).toHaveBeenCalledWith('owner-1', 'salon-1');
    });

    it('throws SALON_NOT_FOUND for a missing salon', async () => {
      prisma.salon.findUnique.mockResolvedValue(null);
      await expect(service.get('owner-1', 'missing')).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
    });
  });

  describe('update', () => {
    it('updates only the safe, provided fields', async () => {
      const result = await service.update('owner-1', 'salon-1', { name: 'New Name' });
      expect(prisma.salon.update).toHaveBeenCalledWith({
        where: { id: 'salon-1' },
        data: { name: 'New Name' },
        select: expect.objectContaining({ name: true, phone: true, email: true, addressLine: true, postalCode: true, description: true }),
      });
      expect(result.name).toBe('New Name');
    });

    it('clears an optional field when given an empty string', async () => {
      await service.update('owner-1', 'salon-1', { phone: '' });
      expect(prisma.salon.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { phone: null } }),
      );
    });

    it('validates a changed postal code against the salon\'s own stored country', async () => {
      await expect(
        service.update('owner-1', 'salon-1', { postalCode: '12' }),
      ).rejects.toMatchObject({ code: 'SALON_POSTAL_CODE_INVALID' });
      expect(prisma.salon.update).not.toHaveBeenCalled();
    });

    it('accepts a valid postal code for the stored country', async () => {
      await expect(
        service.update('owner-1', 'salon-1', { postalCode: '110001' }),
      ).resolves.toBeDefined();
    });

    it('never writes slug/cityId/publicId/ownerUserId/status — those keys never appear in the update payload', async () => {
      await service.update('owner-1', 'salon-1', {
        name: 'New Name',
        phone: '+919999999999',
        email: 'new@example.com',
        addressLine: 'New Address',
        postalCode: '110001',
        description: 'New description',
      });
      const data = prisma.salon.update.mock.calls[0][0].data;
      expect(Object.keys(data).sort()).toEqual(
        ['addressLine', 'description', 'email', 'name', 'phone', 'postalCode'].sort(),
      );
    });

    it('throws SALON_NOT_FOUND for a missing salon', async () => {
      prisma.salon.findUnique.mockResolvedValue(null);
      await expect(
        service.update('owner-1', 'missing', { name: 'X' }),
      ).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
    });

    it('an owner update never writes an AuditLog row', async () => {
      await service.update('owner-1', 'salon-1', { name: 'New Name' });
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    // Part 2 — PLATFORM_ADMIN delegated shop management.
    it('PLATFORM_ADMIN managing an ACTIVE salon can update the profile and it is recorded under the real admin actor', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValue('PLATFORM_ADMIN');
      const result = await service.update('admin-1', 'salon-1', { name: 'Admin-Fixed Name' });
      expect(result.name).toBe('Admin-Fixed Name');
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'ADMIN_SALON_PROFILE_UPDATED',
          entityType: 'Salon',
          entityId: 'salon-1',
          metadata: expect.objectContaining({
            before: { name: 'Original Name' },
            after: { name: 'Admin-Fixed Name' },
          }),
        }),
      });
    });

    it('a normal CUSTOMER is denied and nothing is written', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.update('customer-1', 'salon-1', { name: 'Hijack' }),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.salon.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('PLATFORM_ADMIN against a non-ACTIVE salon is denied (assertOwnerOrAdminAccess\'s own rule)', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.update('admin-1', 'pending-salon', { name: 'X' }),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    });
  });
});
