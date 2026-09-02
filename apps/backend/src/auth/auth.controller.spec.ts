import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { REFRESH_TOKEN_COOKIE_NAME } from '@barbercue/shared';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController — refresh cookie attributes', () => {
  let controller: AuthController;
  let authService: { refresh: jest.Mock };
  let res: { cookie: jest.Mock };

  beforeEach(async () => {
    authService = {
      refresh: jest.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'rotated-refresh-token',
      }),
    };
    res = { cookie: jest.fn() };
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
});
