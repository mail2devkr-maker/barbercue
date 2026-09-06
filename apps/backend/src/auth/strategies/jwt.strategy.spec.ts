import { Role, SessionAudience, UserStatus } from '@barbercue/shared';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import type { JwtPayload } from '../services/token.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: { user: { findUnique: jest.Mock } };

  const activeUser = { id: 'u1', status: UserStatus.ACTIVE };

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'test-only-secret-not-for-production-use';
    prisma = { user: { findUnique: jest.fn().mockResolvedValue(activeUser) } };
    strategy = new JwtStrategy(prisma as unknown as PrismaService);
  });

  function payload(overrides: Partial<JwtPayload> & { audience?: unknown } = {}): JwtPayload {
    return {
      sub: 'u1',
      roles: [Role.CUSTOMER],
      audience: SessionAudience.CUSTOMER,
      ...overrides,
    } as JwtPayload;
  }

  // Fix 3 (fail closed on legacy/invalid access token audience) — a pre-fix access token has no
  // `audience` claim at all, even though the TS type now declares it required; letting it through
  // with `audience: undefined` and relying only on RolesGuard's later PLATFORM_ADMIN check would
  // leave every other consumer of AuthenticatedUser (e.g. /auth/me) seeing an undefined audience
  // for up to the token's full 15-minute TTL. This must reject outright, immediately.
  it('rejects a token with a missing audience claim (a pre-fix access token)', async () => {
    const raw = payload();
    delete (raw as { audience?: unknown }).audience;
    await expect(strategy.validate(raw)).rejects.toThrow(AppException);
    await expect(strategy.validate(raw)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a token with an unrecognized/invalid audience value', async () => {
    const raw = payload({ audience: 'SUPERUSER' as never });
    await expect(strategy.validate(raw)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a token with a null audience', async () => {
    const raw = payload({ audience: null as never });
    await expect(strategy.validate(raw)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('accepts a valid CUSTOMER audience', async () => {
    const result = await strategy.validate(
      payload({ roles: [Role.CUSTOMER], audience: SessionAudience.CUSTOMER }),
    );
    expect(result).toEqual({
      id: 'u1',
      roles: [Role.CUSTOMER],
      audience: SessionAudience.CUSTOMER,
    });
  });

  it('accepts a valid STAFF audience', async () => {
    const result = await strategy.validate(
      payload({ roles: [Role.SALON_OWNER], audience: SessionAudience.STAFF }),
    );
    expect(result).toEqual({
      id: 'u1',
      roles: [Role.SALON_OWNER],
      audience: SessionAudience.STAFF,
    });
  });

  it('accepts a valid ADMIN audience', async () => {
    const result = await strategy.validate(
      payload({ roles: [Role.PLATFORM_ADMIN], audience: SessionAudience.ADMIN }),
    );
    expect(result).toEqual({
      id: 'u1',
      roles: [Role.PLATFORM_ADMIN],
      audience: SessionAudience.ADMIN,
    });
  });

  it('still rejects a suspended user even with a perfectly valid audience', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', status: UserStatus.SUSPENDED });
    await expect(
      strategy.validate(payload({ audience: SessionAudience.CUSTOMER })),
    ).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
  });

  it('rejects when the user no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      strategy.validate(payload({ audience: SessionAudience.CUSTOMER })),
    ).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
  });
});
