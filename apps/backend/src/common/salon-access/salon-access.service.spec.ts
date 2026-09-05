import { Test } from '@nestjs/testing';
import { Role, SalonStatus } from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SalonAccessService } from './salon-access.service';

describe('SalonAccessService', () => {
  let service: SalonAccessService;
  let prisma: {
    userRole: { findFirst: jest.Mock };
    salon: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      userRole: { findFirst: jest.fn() },
      salon: { findUnique: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalonAccessService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(SalonAccessService);
  });

  it('allows the owner of salon A to perform owner-only actions at salon A', async () => {
    prisma.userRole.findFirst.mockResolvedValue({
      userId: 'mixed-role-user',
      salonId: 'salon-a',
      role: Role.SALON_OWNER,
    });

    await expect(
      service.assertOwnerAccess('mixed-role-user', 'salon-a'),
    ).resolves.toBeUndefined();

    expect(prisma.userRole.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'mixed-role-user',
        salonId: 'salon-a',
        role: { in: [Role.SALON_OWNER] },
      },
    });
  });

  it('denies owner-only actions at salon B when the same global owner is only staff there', async () => {
    prisma.userRole.findFirst.mockResolvedValue(null);

    await expect(
      service.assertOwnerAccess('mixed-role-user', 'salon-b'),
    ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });

    expect(prisma.userRole.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'mixed-role-user',
        salonId: 'salon-b',
        role: { in: [Role.SALON_OWNER] },
      },
    });
  });

  it('keeps legitimate staff-capable actions available at salon B', async () => {
    prisma.userRole.findFirst.mockResolvedValue({
      userId: 'mixed-role-user',
      salonId: 'salon-b',
      role: Role.SALON_STAFF,
    });

    await expect(
      service.assertAccess('mixed-role-user', 'salon-b'),
    ).resolves.toBeUndefined();

    expect(prisma.userRole.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'mixed-role-user',
        salonId: 'salon-b',
        role: { in: [Role.SALON_STAFF, Role.SALON_OWNER] },
      },
    });
  });

  it('denies an unrelated salon C for both owner-only and staff-capable actions', async () => {
    prisma.userRole.findFirst.mockResolvedValue(null);

    await expect(
      service.assertOwnerAccess('mixed-role-user', 'salon-c'),
    ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    await expect(
      service.assertAccess('mixed-role-user', 'salon-c'),
    ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
  });

  // Part 2 — PLATFORM_ADMIN delegated shop management.
  describe('assertOwnerOrAdminAccess', () => {
    it('grants access to the real owner without ever checking for a global admin role', async () => {
      prisma.userRole.findFirst.mockResolvedValueOnce({ role: Role.SALON_OWNER });
      await expect(
        service.assertOwnerOrAdminAccess('owner-1', 'salon-1'),
      ).resolves.toBe('OWNER');
      expect(prisma.userRole.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.salon.findUnique).not.toHaveBeenCalled();
    });

    it('grants a PLATFORM_ADMIN access to an ACTIVE salon', async () => {
      prisma.userRole.findFirst
        .mockResolvedValueOnce(null) // not the owner
        .mockResolvedValueOnce({ role: Role.PLATFORM_ADMIN }); // is a global admin
      prisma.salon.findUnique.mockResolvedValue({ status: SalonStatus.ACTIVE });
      await expect(
        service.assertOwnerOrAdminAccess('admin-1', 'salon-1'),
      ).resolves.toBe('PLATFORM_ADMIN');
    });

    it('denies a PLATFORM_ADMIN a PENDING salon — no moderation backdoor for lifecycle-incomplete shops', async () => {
      prisma.userRole.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ role: Role.PLATFORM_ADMIN });
      prisma.salon.findUnique.mockResolvedValue({ status: SalonStatus.PENDING });
      await expect(
        service.assertOwnerOrAdminAccess('admin-1', 'salon-1'),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    });

    it('denies a PLATFORM_ADMIN a SUSPENDED salon', async () => {
      prisma.userRole.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ role: Role.PLATFORM_ADMIN });
      prisma.salon.findUnique.mockResolvedValue({ status: SalonStatus.SUSPENDED });
      await expect(
        service.assertOwnerOrAdminAccess('admin-1', 'salon-1'),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    });

    it('throws SALON_NOT_FOUND for a real admin acting on a salonId that does not exist', async () => {
      prisma.userRole.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ role: Role.PLATFORM_ADMIN });
      prisma.salon.findUnique.mockResolvedValue(null);
      await expect(
        service.assertOwnerOrAdminAccess('admin-1', 'missing-salon'),
      ).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
    });

    it('denies a normal CUSTOMER with neither an owner UserRole row nor a global PLATFORM_ADMIN row', async () => {
      prisma.userRole.findFirst.mockResolvedValue(null);
      await expect(
        service.assertOwnerOrAdminAccess('customer-1', 'salon-1'),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.salon.findUnique).not.toHaveBeenCalled();
    });

    it('denies a SALON_STAFF member with no owner access and no admin role — staff cannot use owner/admin-only mutations', async () => {
      prisma.userRole.findFirst.mockResolvedValue(null); // neither the OWNER nor PLATFORM_ADMIN lookup matches a staff-only row
      await expect(
        service.assertOwnerOrAdminAccess('staff-1', 'salon-1'),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    });

    it("an unrelated SALON_OWNER (owner of a different salon) is denied — cannot manage another owner's salon", async () => {
      // This owner's UserRole row exists, but for a different salonId — findFirst is scoped by
      // salonId in the where-clause, so a real Prisma call would already return null here; the
      // mock mirrors that by resolving null for both lookups against THIS salonId.
      prisma.userRole.findFirst.mockResolvedValue(null);
      await expect(
        service.assertOwnerOrAdminAccess('other-owner-1', 'salon-1'),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    });
  });
});
