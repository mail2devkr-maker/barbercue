import { AuthErrorCode } from '@barbercue/shared';
import { buildPasswordLink, passwordWebBaseUrl } from './password-link';

describe('password links', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousWebBaseUrl = process.env.WEB_BASE_URL;

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousWebBaseUrl === undefined) delete process.env.WEB_BASE_URL;
    else process.env.WEB_BASE_URL = previousWebBaseUrl;
  });

  it('builds an absolute audience-aware link without leaking a token anywhere else', () => {
    process.env.NODE_ENV = 'test';
    process.env.WEB_BASE_URL = 'http://localhost:3001/';
    expect(
      buildPasswordLink(passwordWebBaseUrl(), 'raw-token', 'staff', 'invite'),
    ).toBe(
      'http://localhost:3001/reset-password?token=raw-token&audience=staff&intent=invite',
    );
  });

  it('requires an absolute HTTPS web origin in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEB_BASE_URL = 'http://insecure.example.com';
    expect(() => passwordWebBaseUrl()).toThrow(
      expect.objectContaining({ code: AuthErrorCode.EMAIL_DELIVERY_UNAVAILABLE }),
    );
  });
});
