import { Role, StaffMemberStatus, type AuthenticatedUser } from '@barbercue/shared';
import { StaffStatusService } from './staff-status.service';

// A barber who goes off duty must not stay holding a customer who has been assigned to them.
function build(staffStatusAfter: StaffMemberStatus) {
  const prisma: any = {
    salonStaff: {
      findUnique: jest.fn().mockResolvedValue({ id: 'st1', salonId: 's1', userId: 'u-barber', displayName: 'Marcus', accessRevokedAt: null }),
      update: jest.fn().mockResolvedValue({ id: 'st1', displayName: 'Marcus', status: staffStatusAfter }),
    },
  };
  const salonAccess: any = { assertOwnerAccess: jest.fn().mockResolvedValue(undefined) };
  const realtime: any = { emitStaffStatusChanged: jest.fn() };
  const trigger: any = { trigger: jest.fn() };
  const release: any = { releaseForStaff: jest.fn().mockResolvedValue(1) };
  const service = new StaffStatusService(prisma, salonAccess, realtime, trigger, release);
  return { service, trigger, release };
}

const barber: AuthenticatedUser = { id: 'u-barber', roles: [Role.SALON_STAFF] } as AuthenticatedUser;

describe('StaffStatusService - assigned customers and duty status', () => {
  it('going OFF duty releases the customer assigned to that barber and does not trigger a new assignment to them', async () => {
    const h = build(StaffMemberStatus.INACTIVE);
    await h.service.updateStatus(barber, 'st1', StaffMemberStatus.INACTIVE);
    expect(h.release.releaseForStaff).toHaveBeenCalledWith('s1', 'st1', 'STAFF_OFF_DUTY', 'u-barber');
    expect(h.trigger.trigger).not.toHaveBeenCalled();
  });

  it('coming ON duty gives the allocator a chance and releases nothing', async () => {
    const h = build(StaffMemberStatus.ACTIVE);
    await h.service.updateStatus(barber, 'st1', StaffMemberStatus.ACTIVE);
    expect(h.trigger.trigger).toHaveBeenCalledWith('s1');
    expect(h.release.releaseForStaff).not.toHaveBeenCalled();
  });
});
