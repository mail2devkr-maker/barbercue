import { Reflector } from '@nestjs/core';
import { Role } from '@barbercue/shared';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AdminSecurityController } from './admin-security.controller';

describe('AdminSecurityController authorization matrix', () => {
  const reflector = new Reflector();
  const methodRoles = (methodName: string) => {
    const handler = Object.getOwnPropertyDescriptor(
      AdminSecurityController.prototype,
      methodName,
    )?.value as (...args: never[]) => unknown;
    return reflector.get<Role[]>(ROLES_KEY, handler);
  };

  it('defaults to PLATFORM_ADMIN only', () => {
    expect(reflector.get<Role[]>(ROLES_KEY, AdminSecurityController)).toEqual([
      Role.PLATFORM_ADMIN,
    ]);
  });

  it('allows only CO_FOUNDER to submit non-destructive shop deletion requests', () => {
    expect(methodRoles('requestDeletion')).toEqual([Role.CO_FOUNDER]);
  });

  it('keeps approval, rejection, queue and audit exclusively Super Admin', () => {
    for (const name of ['approve', 'reject', 'listRequests', 'listAudit']) {
      // Undefined method metadata is intentional: inherit PLATFORM_ADMIN.
      expect(methodRoles(name)).toBeUndefined();
    }
  });

  it('never has a direct shop deletion action on the security controller', () => {
    expect(Object.getOwnPropertyNames(AdminSecurityController.prototype))
      .not.toContain('deleteShop');
  });
});
