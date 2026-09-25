import { Reflector } from '@nestjs/core';
import { Role } from '@barbercue/shared';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AdminController } from './admin.controller';

describe('AdminController authorization', () => {
  it('requires the stored PLATFORM_ADMIN role at controller level', () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, AdminController)).toEqual([
      Role.PLATFORM_ADMIN,
    ]);
  });

  it('allows PLATFORM_VIEWER on overview while keeping controller-level writes PLATFORM_ADMIN-only', async () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, AdminController.prototype.overview)).toEqual([
      Role.PLATFORM_ADMIN,
      Role.PLATFORM_VIEWER,
    ]);
    const overview = { generatedAt: '2026-08-28T00:00:00.000Z' };
    const monitoring = { getOverview: jest.fn().mockResolvedValue(overview) };
    const verification = {
      list: jest.fn(),
      getOne: jest.fn(),
      startReview: jest.fn(),
      decide: jest.fn(),
    };
    const salonManagement = { deleteSalon: jest.fn() };
    const activation = { updateStatusAsAdmin: jest.fn() };
    const controller = new AdminController(
      monitoring as never,
      verification as never,
      salonManagement as never,
      activation as never,
      {} as never,
      {} as never,
    );
    await expect(
      controller.overview({
        id: 'viewer-1',
        roles: [Role.PLATFORM_VIEWER],
        audience: 'ADMIN',
      } as never),
    ).resolves.toBe(overview);
    expect(monitoring.getOverview).toHaveBeenCalledWith({ maskPii: true });

    monitoring.getOverview.mockClear();
    monitoring.getOverview.mockResolvedValue(overview);
    await controller.overview({
      id: 'admin-1',
      roles: [Role.PLATFORM_ADMIN],
      audience: 'ADMIN',
    } as never);
    expect(monitoring.getOverview).toHaveBeenCalledWith({ maskPii: false });
  });

  // Phase 18 — the only mutating surface on this otherwise read-only controller: a human
  // PLATFORM_ADMIN's explicit approve/reject decision, never an automated one.
  it('delegates the verification review-queue operations', async () => {
    const monitoring = { getOverview: jest.fn() };
    const verification = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      getOne: jest.fn().mockResolvedValue({ id: 'vr-1' }),
      startReview: jest.fn().mockResolvedValue({ id: 'vr-1', status: 'UNDER_REVIEW' }),
      decide: jest.fn().mockResolvedValue({ id: 'vr-1', status: 'APPROVED' }),
    };
    const salonManagement = { deleteSalon: jest.fn() };
    const activation = { updateStatusAsAdmin: jest.fn() };
    const controller = new AdminController(
      monitoring as never,
      verification as never,
      salonManagement as never,
      activation as never,
      {} as never,
      {} as never,
    );

    await controller.listVerification('SUBMITTED', undefined, undefined);
    expect(verification.list).toHaveBeenCalledWith('SUBMITTED', undefined, undefined);

    await controller.getVerification('vr-1');
    expect(verification.getOne).toHaveBeenCalledWith('vr-1');

    await controller.startReview({ id: 'admin-1' } as never, 'vr-1');
    expect(verification.startReview).toHaveBeenCalledWith('admin-1', 'vr-1');

    await controller.decide({ id: 'admin-1' } as never, 'vr-1', {
      decision: 'APPROVED',
      reviewNotes: undefined,
    } as never);
    expect(verification.decide).toHaveBeenCalledWith('admin-1', 'vr-1', 'APPROVED', undefined);
  });

  it('delegates shop deletion to AdminSalonManagementService', async () => {
    const monitoring = { getOverview: jest.fn() };
    const verification = {
      list: jest.fn(),
      getOne: jest.fn(),
      startReview: jest.fn(),
      decide: jest.fn(),
    };
    const salonManagement = {
      deleteSalon: jest.fn().mockResolvedValue({ deleted: true }),
    };
    const activation = { updateStatusAsAdmin: jest.fn() };
    const controller = new AdminController(
      monitoring as never,
      verification as never,
      salonManagement as never,
      activation as never,
      {} as never,
      {} as never,
    );

    await controller.deleteShop({ id: 'admin-1' } as never, 'salon-1');
    expect(salonManagement.deleteSalon).toHaveBeenCalledWith('admin-1', 'salon-1');
  });

  it('delegates lifecycle status changes to the activation service', async () => {
    const monitoring = { getOverview: jest.fn() };
    const verification = { list: jest.fn(), getOne: jest.fn(), startReview: jest.fn(), decide: jest.fn() };
    const salonManagement = { deleteSalon: jest.fn() };
    const activation = { updateStatusAsAdmin: jest.fn().mockResolvedValue({ id: 'salon-1', status: 'ACTIVE' }) };
    const controller = new AdminController(
      monitoring as never,
      verification as never,
      salonManagement as never,
      activation as never,
      {} as never,
      {} as never,
    );
    await expect(controller.updateShopStatus({ id: 'admin-1' } as never, 'salon-1', { status: 'ACTIVE' } as never)).resolves.toEqual({ id: 'salon-1', status: 'ACTIVE' });
    expect(activation.updateStatusAsAdmin).toHaveBeenCalledWith('admin-1', 'salon-1', { status: 'ACTIVE' });
  });
});
