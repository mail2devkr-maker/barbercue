import { Test } from '@nestjs/testing';
import { generateKeyPairSync } from 'node:crypto';
import type { Response } from 'express';
import {
  REFRESH_TOKEN_COOKIE_NAME,
  Role,
  SessionAudience,
  accountDeletionRequestSchema,
} from '@barbercue/shared';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    refresh: jest.Mock;
    deleteCustomerAccount: jest.Mock;
    getAccountDeletionRequest: jest.Mock;
    requestAccountDeletion: jest.Mock;
    cancelAccountDeletionRequest: jest.Mock;
  };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  beforeEach(async () => {
    authService = {
      refresh: jest.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'rotated-refresh-token',
      }),
      deleteCustomerAccount: jest.fn().mockResolvedValue({
        success: true,
        appleRevocation: 'not_applicable',
      }),
      getAccountDeletionRequest: jest.fn().mockResolvedValue({
        request: null,
        resolution: 'EMPLOYMENT_RESOLUTION_REQUIRED',
        relatedShopCount: 1,
      }),
      requestAccountDeletion: jest.fn().mockResolvedValue({
        request: {
          id: 'request-1',
          status: 'REQUESTED',
          createdAt: '2026-10-28T10:00:00.000Z',
          updatedAt: '2026-10-28T10:00:00.000Z',
        },
        resolution: 'EMPLOYMENT_RESOLUTION_REQUIRED',
        relatedShopCount: 1,
      }),
      cancelAccountDeletionRequest: jest.fn().mockResolvedValue({
        request: {
          id: 'request-1',
          status: 'CANCELLED',
          createdAt: '2026-10-28T10:00:00.000Z',
          updatedAt: '2026-10-28T10:05:00.000Z',
        },
        resolution: 'EMPLOYMENT_RESOLUTION_REQUIRED',
        relatedShopCount: 1,
      }),
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
    ).resolves.toEqual({
      success: true,
      appleRevocation: 'not_applicable',
    });

    expect(authService.deleteCustomerAccount).toHaveBeenCalledWith(
      'customer-a',
      SessionAudience.CUSTOMER,
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
  });

  it('reads deletion status only for the authenticated JWT subject', async () => {
    await controller.accountDeletionRequestStatus({
      id: 'caller-a',
      roles: [Role.SALON_STAFF],
      audience: SessionAudience.STAFF,
    });

    expect(authService.getAccountDeletionRequest).toHaveBeenCalledWith(
      'caller-a',
    );
  });

  it('creates a deletion request for the authenticated subject and ignores any target identifier', async () => {
    const result = await controller.requestAccountDeletion(
      {
        id: 'caller-a',
        roles: [Role.SALON_OWNER],
        audience: SessionAudience.STAFF,
      },
      { confirmation: 'REQUEST_DELETION', userId: 'victim-b' } as never,
    );

    expect(authService.requestAccountDeletion).toHaveBeenCalledWith('caller-a');
    expect(authService.requestAccountDeletion).not.toHaveBeenCalledWith(
      'victim-b',
    );
    expect(result).toMatchObject({ request: { id: 'request-1' } });
  });

  it('withdraws only the current authenticated subject’s deletion request', async () => {
    await controller.cancelAccountDeletionRequest({
      id: 'caller-a',
      roles: [Role.SALON_STAFF],
      audience: SessionAudience.STAFF,
    });

    expect(authService.cancelAccountDeletionRequest).toHaveBeenCalledWith(
      'caller-a',
    );
    expect(authService.cancelAccountDeletionRequest).not.toHaveBeenCalledWith(
      'victim-b',
    );
  });

  it('requires the explicit request confirmation and strips client-supplied account targets', () => {
    expect(
      accountDeletionRequestSchema.safeParse({
        confirmation: 'REQUEST_DELETION',
        userId: 'victim-b',
      }),
    ).toEqual({
      success: true,
      data: { confirmation: 'REQUEST_DELETION' },
    });
    expect(
      accountDeletionRequestSchema.safeParse({ confirmation: 'DELETE' })
        .success,
    ).toBe(false);
  });

  it('advertises configured Google and Apple login without returning client identifiers', () => {
    const names = [
      'GOOGLE_WEB_CLIENT_ID',
      'GOOGLE_ANDROID_CLIENT_ID',
      'GOOGLE_IOS_CLIENT_ID',
      'APPLE_IOS_CLIENT_ID',
      'APPLE_TEAM_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY',
      'TOTP_ENCRYPTION_KEY',
    ] as const;
    const originals = new Map(names.map((name) => [name, process.env[name]]));
    try {
      for (const name of names) delete process.env[name];
      process.env.GOOGLE_IOS_CLIENT_ID = 'public-google-ios-client-id';
      process.env.APPLE_IOS_CLIENT_ID = 'com.dcw.fastque';
      process.env.APPLE_TEAM_ID = 'ABCDE12345';
      process.env.APPLE_KEY_ID = 'FGHIJ67890';
      process.env.APPLE_PRIVATE_KEY = generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
      })
        .privateKey.export({ format: 'pem', type: 'pkcs8' })
        .toString();
      process.env.TOTP_ENCRYPTION_KEY = 'test-only-encryption-key';

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
