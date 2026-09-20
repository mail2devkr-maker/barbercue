import { JwtService } from '@nestjs/jwt';
import { Role, SessionAudience } from '@barbercue/shared';
import { TokenService } from './token.service';
import { AppException } from '../../common/exceptions/app.exception';

describe('TokenService employee refresh scope', () => {
  function makeService(salonId: string | null) {
    const prisma = {
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({
          id: 'rt1',
          userId: 'u1',
          tokenHash: 'irrelevant',
          audience: SessionAudience.EMPLOYEE,
          deviceInfo: null,
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: new Date(),
          createdAt: new Date(),
          user: {
            roles: [{ role: Role.FIELD_EXECUTIVE, salonId }],
          },
        }),
        create: jest.fn().mockResolvedValue({ id: 'rt2' }),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const jwt = { sign: jest.fn().mockReturnValue('signed') };
    const service = new TokenService(
      jwt as unknown as JwtService,
      prisma as never,
    );
    return { service, prisma };
  }

  it('keeps a global FIELD_EXECUTIVE session valid on refresh', async () => {
    const { service, prisma } = makeService(null);

    const result = await service.rotateRefreshToken('raw-token');

    expect(result.accessToken).toBe('signed');
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('kills an EMPLOYEE refresh session if FIELD_EXECUTIVE is salon-scoped', async () => {
    const { service, prisma } = makeService('salon-1');

    await expect(service.rotateRefreshToken('raw-token')).rejects.toBeInstanceOf(
      AppException,
    );
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});
