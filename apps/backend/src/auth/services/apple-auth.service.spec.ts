import { generateKeyPairSync, createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { AuthErrorCode } from '@barbercue/shared';
import { AppleAuthService } from './apple-auth.service';

describe('AppleAuthService', () => {
  const originalClientId = process.env.APPLE_IOS_CLIENT_ID;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const privateKeyPem = privateKey
    .export({ format: 'pem', type: 'pkcs8' })
    .toString();
  const jwk = {
    ...(publicKey.export({ format: 'jwk' }) as JsonWebKey),
    kid: 'apple-test-key',
    use: 'sig',
    alg: 'RS256',
  };
  let prisma: { appleAuthNonce: { create: jest.Mock; deleteMany: jest.Mock } };
  let jwtService: JwtService;
  let service: AppleAuthService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.APPLE_IOS_CLIENT_ID = 'com.dcw.fastque';
    prisma = {
      appleAuthNonce: {
        create: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    jwtService = new JwtService();
    service = new AppleAuthService(prisma as any, jwtService);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [jwk] }),
    } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalClientId === undefined) delete process.env.APPLE_IOS_CLIENT_ID;
    else process.env.APPLE_IOS_CLIENT_ID = originalClientId;
  });

  async function signedToken(overrides: Record<string, unknown> = {}) {
    return jwtService.signAsync(
      {
        sub: 'apple-subject',
        nonce: 'challenge-value-that-is-long-enough-1234567890',
        email: 'private@privaterelay.appleid.com',
        email_verified: 'true',
        ...overrides,
      },
      {
        secret: privateKeyPem,
        algorithm: 'RS256',
        issuer: 'https://appleid.apple.com',
        audience: 'com.dcw.fastque',
        keyid: 'apple-test-key',
        expiresIn: '5m',
      },
    );
  }

  it('cryptographically verifies Apple signature, issuer, audience, expiry, and exact nonce', async () => {
    const token = await signedToken();
    await expect(
      service.verifyIdToken(
        token,
        'challenge-value-that-is-long-enough-1234567890',
      ),
    ).resolves.toEqual({
      sub: 'apple-subject',
      email: 'private@privaterelay.appleid.com',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://appleid.apple.com/auth/keys',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects a mismatched nonce without returning provider claims', async () => {
    const token = await signedToken();
    await expect(
      service.verifyIdToken(token, 'different-challenge-value-123456789012345'),
    ).rejects.toMatchObject({ code: AuthErrorCode.APPLE_TOKEN_INVALID });
  });

  it('rejects tokens for an unexpected issuer or audience', async () => {
    const badIssuer = await jwtService.signAsync(
      {
        sub: 'apple-subject',
        nonce: 'expected-nonce-value-12345678901234567890',
      },
      {
        secret: privateKeyPem,
        algorithm: 'RS256',
        issuer: 'https://attacker.example',
        audience: 'com.dcw.fastque',
        keyid: 'apple-test-key',
        expiresIn: '5m',
      },
    );
    await expect(
      service.verifyIdToken(
        badIssuer,
        'expected-nonce-value-12345678901234567890',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.APPLE_TOKEN_INVALID });

    const badAudience = await jwtService.signAsync(
      {
        sub: 'apple-subject',
        nonce: 'expected-nonce-value-12345678901234567890',
      },
      {
        secret: privateKeyPem,
        algorithm: 'RS256',
        issuer: 'https://appleid.apple.com',
        audience: 'other.app',
        keyid: 'apple-test-key',
        expiresIn: '5m',
      },
    );
    await expect(
      service.verifyIdToken(
        badAudience,
        'expected-nonce-value-12345678901234567890',
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.APPLE_TOKEN_INVALID });
  });

  it('stores only the nonce digest and consumes the challenge once', async () => {
    const { nonce } = await service.createLoginNonce();
    const tx = {
      appleAuthNonce: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    } as any;
    await service.consumeLoginNonce(tx, nonce);
    expect(prisma.appleAuthNonce.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nonceHash: createHash('sha256').update(nonce).digest('hex'),
        expiresAt: expect.any(Date),
      }),
    });
    expect(tx.appleAuthNonce.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        nonceHash: createHash('sha256').update(nonce).digest('hex'),
        expiresAt: { gt: expect.any(Date) },
      }),
    });

    tx.appleAuthNonce.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.consumeLoginNonce(tx, nonce)).rejects.toMatchObject({
      code: AuthErrorCode.APPLE_TOKEN_INVALID,
    });
  });

  it('fails closed when the Apple client ID is not configured', async () => {
    delete process.env.APPLE_IOS_CLIENT_ID;
    await expect(
      service.verifyIdToken('malformed', 'x'.repeat(43)),
    ).rejects.toMatchObject({
      code: AuthErrorCode.APPLE_TOKEN_INVALID,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
