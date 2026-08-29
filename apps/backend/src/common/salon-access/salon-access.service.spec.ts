import { Test } from '@nestjs/testing';
import { Role } from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SalonAccessService } from './salon-access.service';

describe('SalonAccessService', () => {
  let service: SalonAccessService;
  let prisma: {
    userRole: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      userRole: { findFirst: jest.fn() },
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
});
