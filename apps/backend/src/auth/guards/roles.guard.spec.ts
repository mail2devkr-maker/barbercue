import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, SessionAudience, type AuthenticatedUser } from '@barbercue/shared';
import { RolesGuard } from './roles.guard';
import { AppException } from '../../common/exceptions/app.exception';

function makeContext(user: AuthenticatedUser | undefined): ExecutionContext {
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
      guard.canActivate(
        makeContext({ id: 'u1', roles: [Role.CUSTOMER], audience: SessionAudience.CUSTOMER }),
      ),
    ).toBe(true);
  });

  it('allows a user who holds one of the required roles', () => {
    const reflector = {
      getAllAndOverride: () => [Role.SALON_OWNER, Role.SALON_STAFF],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(
      guard.canActivate(
        makeContext({ id: 'u1', roles: [Role.SALON_STAFF], audience: SessionAudience.STAFF }),
      ),
    ).toBe(true);
  });

  it('rejects a user who holds none of the required roles', () => {
    const reflector = {
      getAllAndOverride: () => [Role.PLATFORM_ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() =>
      guard.canActivate(
        makeContext({ id: 'u1', roles: [Role.CUSTOMER], audience: SessionAudience.CUSTOMER }),
      ),
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
      guard.canActivate(
        makeContext({ id: 'u1', roles: [Role.CUSTOMER], audience: SessionAudience.CUSTOMER }),
      ),
    ).toThrow(AppException);
  });

  // [Test L] Defense-in-depth: a PLATFORM_ADMIN role claim alone must never be sufficient — it
  // must have come from an ADMIN-audience (TOTP-gated) session. This is the guard-level backstop
  // for the same boundary TokenService enforces at issuance time.
  it('[Test L] rejects a token carrying PLATFORM_ADMIN but a non-ADMIN audience — e.g. a leaked or pre-fix role grant', () => {
    const reflector = {
      getAllAndOverride: () => [Role.PLATFORM_ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() =>
      guard.canActivate(
        makeContext({
          id: 'u1',
          roles: [Role.PLATFORM_ADMIN],
          audience: SessionAudience.CUSTOMER,
        }),
      ),
    ).toThrow(AppException);
  });

  it('[Test L] rejects a token carrying PLATFORM_ADMIN with no audience at all — e.g. a pre-fix access token still valid within its 15-minute TTL', () => {
    const reflector = {
      getAllAndOverride: () => [Role.PLATFORM_ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() =>
      guard.canActivate(
        makeContext({
          id: 'u1',
          roles: [Role.PLATFORM_ADMIN],
          audience: undefined as unknown as SessionAudience,
        }),
      ),
    ).toThrow(AppException);
  });

  it('[Test L] allows PLATFORM_ADMIN through when it comes from a genuine ADMIN-audience session', () => {
    const reflector = {
      getAllAndOverride: () => [Role.PLATFORM_ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(
      guard.canActivate(
        makeContext({
          id: 'admin1',
          roles: [Role.PLATFORM_ADMIN],
          audience: SessionAudience.ADMIN,
        }),
      ),
    ).toBe(true);
  });

  it('[Test L] a mixed-role route (SALON_OWNER or PLATFORM_ADMIN) still admits a legitimate STAFF-audience owner', () => {
    const reflector = {
      getAllAndOverride: () => [Role.SALON_OWNER, Role.PLATFORM_ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(
      guard.canActivate(
        makeContext({
          id: 'owner1',
          roles: [Role.SALON_OWNER],
          audience: SessionAudience.STAFF,
        }),
      ),
    ).toBe(true);
  });
});
