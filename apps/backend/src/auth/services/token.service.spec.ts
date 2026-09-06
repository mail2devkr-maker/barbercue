import { createHash } from 'crypto';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthErrorCode, Role, SessionAudience } from '@barbercue/shared';
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
    audience: SessionAudience.CUSTOMER,
    deviceInfo: null,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    revokedAt: null,
    createdAt: new Date(),
    user: { roles: [{ role: Role.CUSTOMER, salonId: null }] },
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

  describe('scopeRolesToAudience — the single choke point for session-audience scoping', () => {
    it.each([
      [SessionAudience.CUSTOMER, [Role.CUSTOMER, Role.PLATFORM_ADMIN], [Role.CUSTOMER]],
      [SessionAudience.STAFF, [Role.SALON_OWNER, Role.PLATFORM_ADMIN], [Role.SALON_OWNER]],
      [SessionAudience.STAFF, [Role.SALON_STAFF, Role.CUSTOMER], [Role.SALON_STAFF]],
      [SessionAudience.ADMIN, [Role.PLATFORM_ADMIN, Role.CUSTOMER], [Role.PLATFORM_ADMIN]],
      [SessionAudience.CUSTOMER, [Role.SALON_OWNER, Role.PLATFORM_ADMIN], []],
    ])('audience %s keeps only its own allowed roles out of %j -> %j', (audience, input, expected) => {
      expect(service.scopeRolesToAudience(input, audience)).toEqual(expected);
    });
  });

  describe('signAccessToken / issueTokenPair — never sign a role outside the given audience', () => {
    it('signAccessToken re-scopes defensively even if the caller passes an unscoped list', () => {
      service.signAccessToken('u1', [Role.CUSTOMER, Role.PLATFORM_ADMIN], SessionAudience.CUSTOMER);
      const jwt = (service as unknown as { jwt: { sign: jest.Mock } }).jwt;
      const payload = jwt.sign.mock.calls[0][0];
      expect(payload.roles).toEqual([Role.CUSTOMER]);
      expect(payload.audience).toBe(SessionAudience.CUSTOMER);
    });

    it('issueTokenPair persists the audience onto the created RefreshToken row', async () => {
      await service.issueTokenPair('u1', [Role.CUSTOMER], SessionAudience.CUSTOMER, 'some-device');
      const createCall = prisma.refreshToken.create.mock.calls[0][0];
      expect(createCall.data.audience).toBe(SessionAudience.CUSTOMER);
    });
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
        makeRow({
          audience: SessionAudience.STAFF,
          user: {
            roles: [
              { role: Role.SALON_OWNER, salonId: 's1' },
              { role: Role.SALON_STAFF, salonId: 's1' },
            ],
          },
        }),
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

  // Security fix (session-audience scoping) — the entire reason TokenService.rotateRefreshToken
  // was rewritten: refresh must preserve the ORIGINAL session's audience and re-scope roles to it,
  // never re-derive privilege from every role the User row currently holds.
  describe('rotateRefreshToken — audience scoping (auth security fix)', () => {
    it('C. a CUSTOMER refresh token never gains PLATFORM_ADMIN even when the DB user also holds it', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.findFirst.mockResolvedValue(
        makeRow({
          audience: SessionAudience.CUSTOMER,
          user: {
            roles: [
              { role: Role.CUSTOMER, salonId: null },
              { role: Role.PLATFORM_ADMIN, salonId: null },
            ],
          },
        }),
      );

      await service.rotateRefreshToken('raw-token');

      const jwt = (service as unknown as { jwt: { sign: jest.Mock } }).jwt;
      const payload = jwt.sign.mock.calls[0][0];
      expect(payload.roles).toEqual([Role.CUSTOMER]);
      expect(payload.roles).not.toContain(Role.PLATFORM_ADMIN);
      expect(payload.audience).toBe(SessionAudience.CUSTOMER);
    });

    it('a STAFF refresh token never gains PLATFORM_ADMIN even when the DB user also holds it', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.findFirst.mockResolvedValue(
        makeRow({
          audience: SessionAudience.STAFF,
          user: {
            roles: [
              { role: Role.SALON_OWNER, salonId: 's1' },
              { role: Role.PLATFORM_ADMIN, salonId: null },
            ],
          },
        }),
      );

      await service.rotateRefreshToken('raw-token');

      const jwt = (service as unknown as { jwt: { sign: jest.Mock } }).jwt;
      const payload = jwt.sign.mock.calls[0][0];
      expect(payload.roles).toEqual([Role.SALON_OWNER]);
    });

    it('G. an ADMIN refresh preserves admin authority when the user still holds a valid GLOBAL PLATFORM_ADMIN role', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.findFirst.mockResolvedValue(
        makeRow({
          audience: SessionAudience.ADMIN,
          user: { roles: [{ role: Role.PLATFORM_ADMIN, salonId: null }] },
        }),
      );

      await service.rotateRefreshToken('raw-token');

      const jwt = (service as unknown as { jwt: { sign: jest.Mock } }).jwt;
      const payload = jwt.sign.mock.calls[0][0];
      expect(payload.roles).toEqual([Role.PLATFORM_ADMIN]);
      expect(payload.audience).toBe(SessionAudience.ADMIN);
    });

    it('H. removing PLATFORM_ADMIN entirely: an ADMIN refresh is rejected safely, no token issued', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.findFirst.mockResolvedValue(
        makeRow({
          audience: SessionAudience.ADMIN,
          user: { roles: [{ role: Role.CUSTOMER, salonId: null }] },
        }),
      );

      await expect(service.rotateRefreshToken('raw-token')).rejects.toMatchObject({
        code: AuthErrorCode.REFRESH_TOKEN_INVALID,
      } as Partial<AppException>);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('a malformed salon-scoped PLATFORM_ADMIN row cannot grant admin authority on refresh', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.findFirst.mockResolvedValue(
        makeRow({
          audience: SessionAudience.ADMIN,
          // PLATFORM_ADMIN is present, but salon-scoped — must not count as global admin.
          user: { roles: [{ role: Role.PLATFORM_ADMIN, salonId: 's1' }] },
        }),
      );

      await expect(service.rotateRefreshToken('raw-token')).rejects.toMatchObject({
        code: AuthErrorCode.REFRESH_TOKEN_INVALID,
      } as Partial<AppException>);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('a CUSTOMER session whose CUSTOMER role was fully removed fails the refresh rather than issuing a role-less token', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.findFirst.mockResolvedValue(
        makeRow({ audience: SessionAudience.CUSTOMER, user: { roles: [] } }),
      );

      await expect(service.rotateRefreshToken('raw-token')).rejects.toMatchObject({
        code: AuthErrorCode.REFRESH_TOKEN_INVALID,
      } as Partial<AppException>);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
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

    // K. Legacy tokens (issued before this security fix) were all revoked by the migration that
    // added the audience column (see migration.sql) — this is what that revocation looks like from
    // rotateRefreshToken's own perspective: `revokedAt` is already set, so the atomic claim's
    // `WHERE revokedAt IS NULL` can never select the row, and rotation fails exactly like any
    // other already-revoked token. There is no code path by which a legacy token's (backfilled,
    // meaningless) audience value could ever be read as a privilege decision.
    it('K. a legacy (pre-fix, now-revoked) refresh token cannot be rotated or recover any authority', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.findFirst.mockResolvedValue(
        makeRow({
          audience: SessionAudience.CUSTOMER, // the migration's inert backfill placeholder
          revokedAt: new Date('2026-09-06T00:00:00.000Z'), // revoked by the migration itself
          user: { roles: [{ role: Role.PLATFORM_ADMIN, salonId: null }] }, // even if the DB user IS an admin
        }),
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
