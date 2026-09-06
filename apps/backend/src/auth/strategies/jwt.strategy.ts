import { HttpStatus, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  AuthErrorCode,
  SessionAudience,
  UserStatus,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import type { JwtPayload } from '../services/token.service';

const VALID_AUDIENCES: ReadonlySet<string> = new Set(
  Object.values(SessionAudience),
);

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET must be set');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // Re-checks the user's status on every request rather than trusting the token for the full 15
  // minutes — a suspended account is blocked immediately, not just after its access token
  // happens to expire. Server remains authoritative (ARCHITECTURE.md), not the token payload.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new AppException(
        AuthErrorCode.ACCOUNT_SUSPENDED,
        'This account is no longer active.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    // Fail-closed, not fail-open: an access token signed before this security fix (or one with any
    // malformed/unrecognized audience) has `payload.audience` missing or invalid at runtime, even
    // though the TS type claims it's always present. Rejecting it outright here — rather than
    // letting it through with an undefined audience and relying only on RolesGuard's later
    // PLATFORM_ADMIN-audience check — closes the full access-token TTL window a pre-fix token would
    // otherwise still have (up to 15 minutes) and guarantees no `undefined`/unrecognized audience
    // value ever reaches `/auth/me`, `setLanguage`, `setInitialPassword`, or any other consumer of
    // AuthenticatedUser. This intentionally forces every pre-fix session — access token AND its
    // refresh token (already revoked by this fix's migration) — to re-authenticate from scratch.
    if (
      typeof payload.audience !== 'string' ||
      !VALID_AUDIENCES.has(payload.audience)
    ) {
      throw new AppException(
        AuthErrorCode.UNAUTHENTICATED,
        'This session is no longer valid. Please log in again.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return { id: user.id, roles: payload.roles, audience: payload.audience };
  }
}
