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

  it('delegates only to the read-only monitoring operation', async () => {
    const overview = { generatedAt: '2026-08-28T00:00:00.000Z' };
    const monitoring = { getOverview: jest.fn().mockResolvedValue(overview) };
    const controller = new AdminController(monitoring as never);
    await expect(controller.overview()).resolves.toBe(overview);
    expect(Object.getOwnPropertyNames(AdminController.prototype)).toEqual([
      'constructor',
      'overview',
    ]);
  });
});
