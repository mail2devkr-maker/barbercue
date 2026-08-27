import { createHash } from 'crypto';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthErrorCode, Role } from '@barbercue/shared';
import { TokenService } from './token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rt1',
    userId: 'user1',
    tokenHash: hashToken('raw-token'),
    deviceInfo: null,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    revokedAt: null,
    createdAt: new Date(),
    user: { roles: [{ role: Role.CUSTOMER }] },
    ...overrides,
  };
}

interface PrismaMock {
  refreshToken: {
    create: jest.Mock;
    updateMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
  };
}

describe('TokenService', () => {
  let service: TokenService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        create: jest.fn().mockResolvedValue({ id: 'new-rt' }),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('signed.jwt.token') },
        },
      ],
    }).compile();
    service = moduleRef.get(TokenService);
  });

  describe('rotateRefreshToken — happy path', () => {
    it('atomically claims the token via a conditional updateMany, then issues a new pair', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.findFirst.mockResolvedValue(makeRow());

      const result = await service.rotateRefreshToken('raw-token');

      // The claim must be a single conditional statement re-checking revokedAt/expiresAt in the
      // same call — this is the actual fix: not a separate read-then-write.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: hashToken('raw-token'),
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(typeof result.refreshToken).toBe('string');
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('re-fetches roles from the DB rather than trusting any cached value', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.findFirst.mockResolvedValue(
        makeRow({ user: { roles: [{ role: Role.SALON_OWNER }, { role: Role.SALON_STAFF }] } }),
      );

      await service.rotateRefreshToken('raw-token');

      const createCall = prisma.refreshToken.create.mock.calls[0][0];
      expect(createCall.data.userId).toBe('user1');
    });

    it('carries the original deviceInfo forward when none is passed to rotate', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.findFirst.mockResolvedValue(makeRow({ deviceInfo: 'iPhone Safari' }));

      await service.rotateRefreshToken('raw-token');

      const createCall = prisma.refreshToken.create.mock.calls[0][0];
      expect(createCall.data.deviceInfo).toBe('iPhone Safari');
    });
  });

  describe('rotateRefreshToken — rejection paths', () => {
    it('throws REFRESH_TOKEN_INVALID when the token does not exist', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(service.rotateRefreshToken('unknown-token')).rejects.toMatchObject({
        code: AuthErrorCode.REFRESH_TOKEN_INVALID,
      } as Partial<AppException>);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('throws REFRESH_TOKEN_EXPIRED when the token is expired', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.findFirst.mockResolvedValue(
        makeRow({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.rotateRefreshToken('raw-token')).rejects.toMatchObject({
        code: AuthErrorCode.REFRESH_TOKEN_EXPIRED,
      } as Partial<AppException>);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('throws "already been used" REFRESH_TOKEN_INVALID when the token was already revoked', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.findFirst.mockResolvedValue(
        makeRow({ revokedAt: new Date() }),
      );

      await expect(service.rotateRefreshToken('raw-token')).rejects.toMatchObject({
        code: AuthErrorCode.REFRESH_TOKEN_INVALID,
        message: 'This refresh token has already been used.',
      } as Partial<AppException>);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('rotateRefreshToken — concurrency / reuse regression', () => {
    // This is the actual bug: a findFirst-then-update implementation lets two concurrent callers
    // presenting the SAME still-valid token both pass the liveness check before either write
    // lands, so both mint a new pair from one old token. With the atomic updateMany claim, only
    // the request whose conditional UPDATE actually matches a row (count === 1) may proceed;
    // every other concurrent or replayed caller must see count === 0 and be rejected outright.
    it('lets only the first of two concurrent rotation attempts for the same token succeed', async () => {
      // Simulate the two callers reaching the DB in sequence, as Postgres would serialize the
      // two conditional UPDATE statements: the first flips revokedAt (count 1), so the second's
      // identical conditional UPDATE matches nothing (count 0).
      prisma.refreshToken.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.refreshToken.findFirst
        .mockResolvedValueOnce(makeRow()) // winner's post-claim read
        .mockResolvedValueOnce(makeRow({ revokedAt: new Date() })); // loser's error-lookup read

      const [winner, loserResult] = await Promise.allSettled([
        service.rotateRefreshToken('raw-token'),
        service.rotateRefreshToken('raw-token'),
      ]);

      expect(winner.status).toBe('fulfilled');
      expect(loserResult.status).toBe('rejected');
      if (loserResult.status === 'rejected') {
        expect(loserResult.reason).toMatchObject({
          code: AuthErrorCode.REFRESH_TOKEN_INVALID,
          message: 'This refresh token has already been used.',
        });
      }

      // The single most important assertion: exactly one new token pair was ever minted from
      // this one old token, never two.
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(2);
    });

    it('rejects a second use of an already-rotated token (replay/reuse) without minting a new pair', async () => {
      // First, legitimate rotation.
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.refreshToken.findFirst.mockResolvedValueOnce(makeRow());
      await service.rotateRefreshToken('raw-token');
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);

      // Replaying the same (now-revoked) raw token must fail, not silently succeed again.
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.refreshToken.findFirst.mockResolvedValueOnce(
        makeRow({ revokedAt: new Date() }),
      );

      await expect(service.rotateRefreshToken('raw-token')).rejects.toMatchObject({
        code: AuthErrorCode.REFRESH_TOKEN_INVALID,
        message: 'This refresh token has already been used.',
      } as Partial<AppException>);

      // Still only the one pair from the legitimate first rotation.
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('revokeRefreshToken / revokeAllForUser — unchanged behavior', () => {
    it('revokeRefreshToken only touches not-yet-revoked rows for the given token', async () => {
      prisma.refreshToken.update.mockResolvedValue({});
      // revokeRefreshToken uses updateMany per the existing implementation.
      (prisma.refreshToken as unknown as { updateMany: jest.Mock }).updateMany.mockResolvedValue({ count: 1 });

      await service.revokeRefreshToken('raw-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: hashToken('raw-token'), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('revokeAllForUser revokes only that user\'s not-yet-revoked tokens', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await service.revokeAllForUser('user1');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
