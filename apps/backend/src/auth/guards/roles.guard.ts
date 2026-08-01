import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AuthErrorCode,
  type AuthenticatedUser,
  type Role,
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
    if (!user || !requiredRoles.some((role) => user.roles.includes(role))) {
      throw new AppException(
        AuthErrorCode.FORBIDDEN_ROLE,
        'You do not have permission to perform this action.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
