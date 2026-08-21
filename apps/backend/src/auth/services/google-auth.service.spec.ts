import { OAuth2Client, type LoginTicket, type TokenPayload } from 'google-auth-library';
import { GoogleAuthService } from './google-auth.service';

function ticketWith(payload: Partial<TokenPayload> | undefined): LoginTicket {
  return { getPayload: () => payload as TokenPayload | undefined } as LoginTicket;
}

describe('GoogleAuthService', () => {
  let service: GoogleAuthService;
  let verifyIdTokenSpy: jest.SpyInstance;
  const originalWebClientId = process.env.GOOGLE_WEB_CLIENT_ID;
  const originalAndroidClientId = process.env.GOOGLE_ANDROID_CLIENT_ID;

  beforeEach(() => {
    process.env.GOOGLE_WEB_CLIENT_ID = 'web-client-id.apps.googleusercontent.com';
    delete process.env.GOOGLE_ANDROID_CLIENT_ID;
    verifyIdTokenSpy = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken');
    service = new GoogleAuthService();
  });

  afterEach(() => {
    process.env.GOOGLE_WEB_CLIENT_ID = originalWebClientId;
    process.env.GOOGLE_ANDROID_CLIENT_ID = originalAndroidClientId;
    jest.restoreAllMocks();
  });

  it('returns the verified sub, email, and name for a valid token with a verified email', async () => {
    verifyIdTokenSpy.mockResolvedValue(
      ticketWith({
        sub: 'google-sub-123',
        email: 'customer@example.com',
        email_verified: true,
        name: 'Alex Customer',
      }),
    );

    const result = await service.verifyIdToken('a-real-google-id-token');

    expect(result).toEqual({
      sub: 'google-sub-123',
      email: 'customer@example.com',
      name: 'Alex Customer',
    });
  });

  it('never surfaces an unverified email — drops it rather than rejecting the sign-in', async () => {
    verifyIdTokenSpy.mockResolvedValue(
      ticketWith({
        sub: 'google-sub-456',
        email: 'unverified@example.com',
        email_verified: false,
        name: 'Someone',
      }),
    );

    const result = await service.verifyIdToken('token');

    expect(result.sub).toBe('google-sub-456');
    expect(result.email).toBeNull();
  });

  it('treats a token with no email at all as a valid identity with a null email', async () => {
    verifyIdTokenSpy.mockResolvedValue(
      ticketWith({ sub: 'google-sub-789', email_verified: undefined }),
    );
    const result = await service.verifyIdToken('token');
    expect(result).toEqual({ sub: 'google-sub-789', email: null, name: null });
  });

  it('throws GOOGLE_TOKEN_INVALID when the token has no sub at all', async () => {
    verifyIdTokenSpy.mockResolvedValue(ticketWith({ email: 'x@example.com' }));
    await expect(service.verifyIdToken('token')).rejects.toMatchObject({
      code: 'GOOGLE_TOKEN_INVALID',
    });
  });

  it('throws GOOGLE_TOKEN_INVALID when Google itself rejects the token (expired/malformed/wrong signature)', async () => {
    verifyIdTokenSpy.mockRejectedValue(new Error('Token used too late'));
    await expect(service.verifyIdToken('expired-token')).rejects.toMatchObject({
      code: 'GOOGLE_TOKEN_INVALID',
    });
  });

  it('throws GOOGLE_TOKEN_INVALID without ever calling Google when no client ID is configured', async () => {
    delete process.env.GOOGLE_WEB_CLIENT_ID;
    delete process.env.GOOGLE_ANDROID_CLIENT_ID;
    await expect(service.verifyIdToken('token')).rejects.toMatchObject({
      code: 'GOOGLE_TOKEN_INVALID',
    });
    expect(verifyIdTokenSpy).not.toHaveBeenCalled();
  });

  it('accepts either the web or Android client ID as a valid audience', async () => {
    process.env.GOOGLE_ANDROID_CLIENT_ID = 'android-client-id.apps.googleusercontent.com';
    verifyIdTokenSpy.mockResolvedValue(
      ticketWith({ sub: 'google-sub-999', email_verified: true, email: 'a@b.com' }),
    );

    await service.verifyIdToken('token');

    expect(verifyIdTokenSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: [
          'web-client-id.apps.googleusercontent.com',
          'android-client-id.apps.googleusercontent.com',
        ],
      }),
    );
  });
});
