import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@barbercue/shared';
import { RolesGuard } from './roles.guard';
import { AppException } from '../../common/exceptions/app.exception';

function makeContext(
  user: { id: string; roles: Role[] } | undefined,
): ExecutionContext {
  return {
    getHandler: () => ({}) as unknown,
    getClass: () => ({}) as unknown,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows any authenticated user through when no @Roles() metadata is present', () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(
      guard.canActivate(makeContext({ id: 'u1', roles: [Role.CUSTOMER] })),
    ).toBe(true);
  });

  it('allows a user who holds one of the required roles', () => {
    const reflector = {
      getAllAndOverride: () => [Role.SALON_OWNER, Role.SALON_STAFF],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(
      guard.canActivate(makeContext({ id: 'u1', roles: [Role.SALON_STAFF] })),
    ).toBe(true);
  });

  it('rejects a user who holds none of the required roles', () => {
    const reflector = {
      getAllAndOverride: () => [Role.PLATFORM_ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() =>
      guard.canActivate(makeContext({ id: 'u1', roles: [Role.CUSTOMER] })),
    ).toThrow(AppException);
  });

  it('rejects when there is no authenticated user at all', () => {
    const reflector = {
      getAllAndOverride: () => [Role.PLATFORM_ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      AppException,
    );
  });

  it('rejects a customer attempting to access an admin-only route', () => {
    const reflector = {
      getAllAndOverride: () => [Role.PLATFORM_ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() =>
      guard.canActivate(makeContext({ id: 'u1', roles: [Role.CUSTOMER] })),
    ).toThrow(AppException);
  });
});
