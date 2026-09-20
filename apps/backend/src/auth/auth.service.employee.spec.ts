import { Language, Role, SessionAudience, UserStatus } from '@barbercue/shared';
import { AuthService } from './auth.service';
import { AppException } from '../common/exceptions/app.exception';

describe('AuthService employee login', () => {
  const fakeTokens = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };

  function makeService(salonId: string | null) {
    const prisma = {
      employeeProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ep1',
          employeeCode: 'FQ-FE-00001',
          user: {
            id: 'u1',
            phone: null,
            email: 'employee@fastque.test',
            passwordHash: 'hash',
            preferredLanguage: Language.EN,
            status: UserStatus.ACTIVE,
            roles: [{ role: Role.FIELD_EXECUTIVE, salonId }],
          },
        }),
      },
    };
    const passwordService = {
      compare: jest.fn().mockResolvedValue(true),
      hash: jest.fn(),
    };
    const tokenService = {
      scopeRolesToAudience: jest
        .fn()
        .mockReturnValue([Role.FIELD_EXECUTIVE]),
      issueTokenPair: jest.fn().mockResolvedValue(fakeTokens),
    };

    const service = new AuthService(
      prisma as never,
      passwordService as never,
      tokenService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, tokenService };
  }

  it('issues an EMPLOYEE session only for a global FIELD_EXECUTIVE role', async () => {
    const { service, tokenService } = makeService(null);

    const result = await service.employeeLogin('fq-fe-00001', 'password');

    expect(tokenService.scopeRolesToAudience).toHaveBeenCalledWith(
      [Role.FIELD_EXECUTIVE],
      SessionAudience.EMPLOYEE,
    );
    expect(tokenService.issueTokenPair).toHaveBeenCalledWith(
      'u1',
      [Role.FIELD_EXECUTIVE],
      SessionAudience.EMPLOYEE,
      undefined,
    );
    expect(result.user.roles).toEqual([Role.FIELD_EXECUTIVE]);
    expect(result.user.audience).toBe(SessionAudience.EMPLOYEE);
  });

  it('rejects a malformed salon-scoped FIELD_EXECUTIVE role', async () => {
    const { service, tokenService } = makeService('salon-1');

    await expect(
      service.employeeLogin('FQ-FE-00001', 'password'),
    ).rejects.toBeInstanceOf(AppException);
    expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
  });
});
