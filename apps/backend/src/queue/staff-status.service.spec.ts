import { Test } from '@nestjs/testing';
import {
  Role,
  StaffMemberStatus,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { StaffStatusService } from './staff-status.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

function makeStaffRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'staff1',
    salonId: 's1',
    userId: 'user-staff1',
    displayName: 'Marcus',
    status: StaffMemberStatus.INACTIVE,
    ...overrides,
  };
}

describe('StaffStatusService', () => {
  let service: StaffStatusService;
  let prisma: {
    salonStaff: {
      findUnique: jest.Mock<Promise<unknown>, [unknown]>;
      findFirst: jest.Mock<Promise<unknown>, [unknown]>;
      update: jest.Mock<Promise<unknown>, [unknown]>;
    };
  };
  let salonAccess: { assertAccess: jest.Mock<Promise<void>, [string, string]> };
  let realtime: { emitStaffStatusChanged: jest.Mock };

  beforeEach(async () => {
    prisma = {
      salonStaff: {
        findUnique: jest.fn<Promise<unknown>, [unknown]>(),
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
        update: jest.fn<Promise<unknown>, [unknown]>(),
      },
    };
    salonAccess = {
      assertAccess: jest
        .fn<Promise<void>, [string, string]>()
        .mockResolvedValue(undefined),
    };
    realtime = { emitStaffStatusChanged: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StaffStatusService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalonAccessService, useValue: salonAccess },
        { provide: RealtimeGateway, useValue: realtime },
      ],
    }).compile();
    service = moduleRef.get(StaffStatusService);
  });

  it('throws STAFF_NOT_FOUND when no SalonStaff row matches', async () => {
    prisma.salonStaff.findUnique.mockResolvedValue(null);
    const owner: AuthenticatedUser = {
      id: 'owner1',
      roles: [Role.SALON_OWNER],
    };
    await expect(
      service.updateStatus(owner, 'missing', StaffMemberStatus.ACTIVE),
    ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
  });

  it('allows a SALON_OWNER to update any staff member at their salon, via SalonAccessService', async () => {
    prisma.salonStaff.findUnique.mockResolvedValue(makeStaffRow());
    prisma.salonStaff.update.mockResolvedValue(
      makeStaffRow({ status: StaffMemberStatus.ACTIVE }),
    );
    const owner: AuthenticatedUser = {
      id: 'owner1',
      roles: [Role.SALON_OWNER],
    };

    const result = await service.updateStatus(
      owner,
      'staff1',
      StaffMemberStatus.ACTIVE,
    );

    expect(salonAccess.assertAccess).toHaveBeenCalledWith('owner1', 's1');
    expect(result.status).toBe(StaffMemberStatus.ACTIVE);
    expect(realtime.emitStaffStatusChanged).toHaveBeenCalledWith(
      's1',
      'staff1',
    );
  });

  it('propagates SALON_ACCESS_DENIED when the owner has no UserRole membership at that salon', async () => {
    prisma.salonStaff.findUnique.mockResolvedValue(makeStaffRow());
    salonAccess.assertAccess.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
    );
    const owner: AuthenticatedUser = {
      id: 'other-owner',
      roles: [Role.SALON_OWNER],
    };

    await expect(
      service.updateStatus(owner, 'staff1', StaffMemberStatus.ACTIVE),
    ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    expect(prisma.salonStaff.update).not.toHaveBeenCalled();
  });

  it('allows a SALON_STAFF to update their own status without any SalonAccessService check', async () => {
    prisma.salonStaff.findUnique.mockResolvedValue(makeStaffRow());
    prisma.salonStaff.update.mockResolvedValue(
      makeStaffRow({ status: StaffMemberStatus.ACTIVE }),
    );
    const self: AuthenticatedUser = {
      id: 'user-staff1',
      roles: [Role.SALON_STAFF],
    };

    await service.updateStatus(self, 'staff1', StaffMemberStatus.ACTIVE);

    expect(salonAccess.assertAccess).not.toHaveBeenCalled();
    expect(prisma.salonStaff.update).toHaveBeenCalledWith({
      where: { id: 'staff1' },
      data: { status: StaffMemberStatus.ACTIVE },
    });
  });

  it("rejects a SALON_STAFF trying to update a different staff member's status", async () => {
    prisma.salonStaff.findUnique.mockResolvedValue(makeStaffRow());
    const otherStaff: AuthenticatedUser = {
      id: 'someone-else',
      roles: [Role.SALON_STAFF],
    };

    await expect(
      service.updateStatus(otherStaff, 'staff1', StaffMemberStatus.ACTIVE),
    ).rejects.toMatchObject({ code: 'NOT_YOUR_STAFF_PROFILE' });
    expect(prisma.salonStaff.update).not.toHaveBeenCalled();
  });

  describe('getMe', () => {
    it('resolves the caller\'s own SalonStaff row at this salon', async () => {
      prisma.salonStaff.findFirst.mockResolvedValue(makeStaffRow());
      const result = await service.getMe('user-staff1', 's1');
      expect(prisma.salonStaff.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-staff1', salonId: 's1' },
      });
      expect(result).toEqual({ id: 'staff1', displayName: 'Marcus', status: StaffMemberStatus.INACTIVE });
    });

    it('returns null (not an error) when this user has no roster row at this salon', async () => {
      prisma.salonStaff.findFirst.mockResolvedValue(null);
      const result = await service.getMe('owner1', 's1');
      expect(result).toBeNull();
    });
  });
});
