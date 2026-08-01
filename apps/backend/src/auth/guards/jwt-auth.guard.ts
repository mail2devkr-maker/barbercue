import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { AuthErrorCode, type AuthenticatedUser } from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Registered globally (see AppModule) — every route requires a valid access token by default.
 * Endpoints that must be reachable without one (OTP request/verify, staff/admin login, refresh)
 * opt out explicitly with @Public(). This is the "No frontend-only authorization" / default-deny
 * posture ARCHITECTURE.md calls for: a new endpoint is locked down unless someone deliberately
 * opens it, not the other way around.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: TUser | false,
  ): TUser {
    if (err || !user) {
      if (err instanceof AppException) throw err;
      throw new AppException(
        AuthErrorCode.UNAUTHENTICATED,
        'Authentication required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return user;
  }
}
