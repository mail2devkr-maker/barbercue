import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { REFRESH_TOKEN_COOKIE_NAME, Role, SessionAudience } from '@barbercue/shared';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { refresh: jest.Mock; deleteCustomerAccount: jest.Mock };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  beforeEach(async () => {
    authService = {
      refresh: jest.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'rotated-refresh-token',
      }),
      deleteCustomerAccount: jest.fn().mockResolvedValue({ success: true }),
    };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    controller = moduleRef.get(AuthController);
  });

  it('sets the rotated refresh cookie as SameSite=Lax, not None — web and backend are same-origin via the Next.js rewrite (see next.config.ts), so a cross-site cookie is both unnecessary and less reliable across a client navigation than a same-site one', async () => {
    const req = { cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'old-refresh-token' }, headers: {} } as any;

    await controller.refresh({} as any, req, res as unknown as Response);

    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      'rotated-refresh-token',
      expect.objectContaining({ sameSite: 'lax', httpOnly: true, path: '/' }),
    );
  });

  it('deletes only the JWT subject and accepts no client-supplied target account', async () => {
    await expect(
      controller.deleteAccount(
        { id: 'customer-a', roles: [Role.CUSTOMER], audience: SessionAudience.CUSTOMER },
        { confirmation: 'DELETE' },
        res as unknown as Response,
      ),
    ).resolves.toEqual({ success: true });

    expect(authService.deleteCustomerAccount).toHaveBeenCalledWith(
      'customer-a',
      SessionAudience.CUSTOMER,
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
  });
});
