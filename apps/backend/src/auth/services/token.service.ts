import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import {
  AuthErrorCode,
  AuthSession,
  AuthTokens,
  Role,
} from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes, per ARCHITECTURE.md §4
const REFRESH_TOKEN_TTL_DAYS = 30;

export interface JwtPayload {
  sub: string;
  roles: Role[];
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Access tokens are short-lived JWTs (stateless, verified by signature). Refresh tokens are
 * opaque, high-entropy random strings — NOT JWTs — stored only as a SHA-256 hash (RefreshToken
 * .tokenHash), the same reasoning DATABASE.md gives for OtpRequest/PasswordResetToken: a DB read
 * alone can never yield a usable token. SHA-256 (not bcrypt) is deliberate here — the token
 * itself is 256 bits of random entropy, not a low-entropy human password, so a fast, non-salted
 * hash is the correct tool (bcrypt's slowness defends against guessing a *low*-entropy secret,
 * which doesn't apply here and would just waste CPU on every refresh).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  signAccessToken(userId: string, roles: Role[]): string {
    const payload: JwtPayload = { sub: userId, roles };
    return this.jwt.sign(payload, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  }

  async issueTokenPair(
    userId: string,
    roles: Role[],
    deviceInfo?: string,
  ): Promise<AuthTokens> {
    const rawRefreshToken = randomBytes(64).toString('hex');
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60_000,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawRefreshToken),
        deviceInfo: deviceInfo ?? null,
        expiresAt,
      },
    });

    return {
      accessToken: this.signAccessToken(userId, roles),
      refreshToken: rawRefreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a new pair is issued, so a
   * stolen-and-reused refresh token is detectable (the legitimate holder's next refresh attempt
   * with the now-revoked token fails, a signal a real implementation would alert on).
   *
   * The revoke is a single atomic conditional `updateMany` (claim-then-read), not a `findFirst`
   * followed by a separate `update` — two concurrent calls presenting the same still-valid token
   * would otherwise both pass a `findFirst`-based liveness check before either write lands, and
   * both would go on to mint a new token pair from one old token (a real, reproduced race: e.g.
   * an app-level silent-refresh effect firing at the same moment as an explicit
   * `refreshSession()` call). `updateMany`'s `where` re-checks `revokedAt`/`expiresAt` as part of
   * the same statement Postgres executes atomically, so at most one concurrent caller's `count`
   * comes back 1 for a given token — every other caller (concurrent or a genuine replay) reaches
   * `count === 0` and is rejected, never issued a second pair.
   */
  async rotateRefreshToken(
    rawRefreshToken: string,
    deviceInfo?: string,
  ): Promise<AuthTokens> {
    const tokenHash = hashToken(rawRefreshToken);
    const now = new Date();

    const claim = await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });

    if (claim.count === 0) {
      // The atomic claim above didn't say *why* — re-read (by the same indexed tokenHash) only
      // to pick the right error message for the caller. This read is not part of the atomicity
      // guarantee; the updateMany above is what actually prevents double-issuance.
      const existing = await this.prisma.refreshToken.findFirst({
        where: { tokenHash },
      });
      if (!existing) {
        throw new AppException(
          AuthErrorCode.REFRESH_TOKEN_INVALID,
          'Invalid refresh token.',
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (existing.expiresAt.getTime() < now.getTime()) {
        throw new AppException(
          AuthErrorCode.REFRESH_TOKEN_EXPIRED,
          'Session expired. Please log in again.',
          HttpStatus.UNAUTHORIZED,
        );
      }
      // Not missing, not expired, and updateMany still matched nothing -> already revoked,
      // whether by a legitimate rotation, an explicit logout, or a concurrent winner above.
      throw new AppException(
        AuthErrorCode.REFRESH_TOKEN_INVALID,
        'This refresh token has already been used.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // We hold the only successful claim on this token — safe to read the row it belongs to.
    const claimed = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: { include: { roles: true } } },
    });
    if (!claimed) {
      // Unreachable in practice (we just revoked this exact row and rows are never deleted),
      // but keeps the method total rather than asserting non-null past the Prisma call.
      throw new AppException(
        AuthErrorCode.REFRESH_TOKEN_INVALID,
        'Invalid refresh token.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Roles are re-fetched from the DB, never trusted from the old token's era — a role change
    // (e.g. staff offboarded) takes effect on the very next refresh, not just on next login.
    const roles = claimed.user.roles.map((r) => r.role);
    return this.issueTokenPair(
      claimed.userId,
      roles,
      deviceInfo ?? claimed.deviceInfo ?? undefined,
    );
  }

  async revokeRefreshToken(rawRefreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async listSessions(
    userId: string,
    currentRawRefreshToken?: string,
  ): Promise<AuthSession[]> {
    const currentHash = currentRawRefreshToken
      ? hashToken(currentRawRefreshToken)
      : null;
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceInfo: s.deviceInfo,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.tokenHash === currentHash,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.refreshToken.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw new AppException(
        'SESSION_NOT_FOUND',
        'Session not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.refreshToken.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }
}
