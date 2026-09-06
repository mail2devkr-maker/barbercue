import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AuthErrorCode,
  Role,
  SessionAudience,
  type AuthenticatedUser,
} from '@barbercue/shared';
import type { Request } from 'express';
import { AppException } from '../../common/exceptions/app.exception';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Runs after JwtAuthGuard (request.user is already populated). A route with no @Roles()
 * metadata is allowed for any authenticated user; a route with @Roles(...) requires the caller
 * to hold at least one of the listed roles. This is the RBAC enforcement mechanism required for
 * Customer/SalonStaff/SalonOwner/PlatformAdmin per ARCHITECTURE.md §5 — server-side only, never
 * trusted from the client.
 *
 * Auth security fix (defense in depth): a matched PLATFORM_ADMIN role is not, by itself, treated
 * as sufficient here — it must ALSO come from an ADMIN-audience session (TokenService only ever
 * sets that audience after the TOTP-gated admin login paths succeed). This is deliberately
 * redundant with issuance-time scoping (TokenService.issueTokenPair/rotateRefreshToken already
 * guarantee a non-ADMIN session's token can never carry PLATFORM_ADMIN at all) — the point is that
 * a future bug in some other issuance path could otherwise leak the role again exactly like the
 * defect this fix closes, and this second, independent check would still catch it at every
 * PLATFORM_ADMIN-protected route. Every other role is unaffected — this never runs for a route
 * that doesn't require PLATFORM_ADMIN, and a mixed route (e.g. SALON_OWNER or PLATFORM_ADMIN)
 * still admits a legitimate STAFF-audience owner exactly as before.
 */
@Injectable()
export class RolesGuard {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    const hasValidMatch = !!user && requiredRoles.some((role) => {
      if (!user.roles.includes(role)) return false;
      if (role === Role.PLATFORM_ADMIN) {
        return user.audience === SessionAudience.ADMIN;
      }
      return true;
    });
    if (!hasValidMatch) {
      throw new AppException(
        AuthErrorCode.FORBIDDEN_ROLE,
        'You do not have permission to perform this action.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
