import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import {
  REFRESH_TOKEN_COOKIE_NAME,
  Role,
  SessionAudience,
} from '@barbercue/shared';
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
    const req = {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'old-refresh-token' },
      headers: {},
    } as any;

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
        {
          id: 'customer-a',
          roles: [Role.CUSTOMER],
          audience: SessionAudience.CUSTOMER,
        },
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

  it('advertises configured Google and Apple login without returning client identifiers', () => {
    const names = [
      'GOOGLE_WEB_CLIENT_ID',
      'GOOGLE_ANDROID_CLIENT_ID',
      'GOOGLE_IOS_CLIENT_ID',
      'APPLE_IOS_CLIENT_ID',
    ] as const;
    const originals = new Map(names.map((name) => [name, process.env[name]]));
    try {
      for (const name of names) delete process.env[name];
      process.env.GOOGLE_IOS_CLIENT_ID = 'public-google-ios-client-id';
      process.env.APPLE_IOS_CLIENT_ID = 'com.dcw.fastque';

      const methods = controller.authMethods();

      expect(methods).toEqual(
        expect.objectContaining({ google: true, apple: true }),
      );
      expect(methods).not.toHaveProperty('googleClientId');
      expect(methods).not.toHaveProperty('appleClientId');
    } finally {
      for (const name of names) {
        const original = originals.get(name);
        if (original === undefined) delete process.env[name];
        else process.env[name] = original;
      }
    }
  });
});
