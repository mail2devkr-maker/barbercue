import { HttpStatus, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  AuthErrorCode,
  UserStatus,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import type { JwtPayload } from '../services/token.service';

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
    return { id: user.id, roles: payload.roles };
  }
}
