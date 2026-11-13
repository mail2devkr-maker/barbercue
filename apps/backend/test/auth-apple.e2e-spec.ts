import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  AUTH_PATHS,
  AuthErrorCode,
  Role,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';

/** Real HTTP/AuthService/Prisma coverage against a disposable local PostgreSQL only. */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = LOCAL_DB ? describe : describe.skip;
const invalidAppleTokenCases: Array<
  [
    string,
    string | null,
    {
      audience?: string;
      issuer?: string;
      expiresIn?: JwtSignOptions['expiresIn'];
    },
  ]
> = [
  ['malformed token', 'malformed', {}],
  ['wrong audience', null, { audience: 'com.other.app' }],
  ['expired token', null, { expiresIn: '-1m' }],
];

maybe('Apple sign-in (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let fetchSpy: jest.SpyInstance;

  const run = randomUUID().replace(/-/g, '');
  const fixtureUserIds = new Set<string>();
  const issuedNonces = new Set<string>();
  const revokedRefreshTokens = new Set<string>();
  const authCodes = new Map<
    string,
    { idToken: string; refreshToken: string }
  >();
  const originalEnvironment = new Map(
    [
      'NODE_ENV',
      'APPLE_IOS_CLIENT_ID',
      'APPLE_TEAM_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY',
      'TOTP_ENCRYPTION_KEY',
    ].map((name) => [name, process.env[name]]),
  );
  const { privateKey: appleIdPrivateKey, publicKey: appleIdPublicKey } =
    generateKeyPairSync('rsa', { modulusLength: 2048 });
  const appleIdPrivateKeyPem = appleIdPrivateKey
    .export({ format: 'pem', type: 'pkcs8' })
    .toString();
  const appleJwk = {
    ...(appleIdPublicKey.export({ format: 'jwk' }) as JsonWebKey),
    kid: 'fastque-apple-e2e-key',
    use: 'sig',
    alg: 'RS256',
  };
  const { privateKey: appleClientPrivateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const appleClientPrivateKeyPem = appleClientPrivateKey
    .export({ format: 'pem', type: 'pkcs8' })
    .toString();

  let syntheticClientAddress = 1;
  const withSyntheticClient = <T extends request.Test>(test: T): T =>
    test.set(
      'X-Forwarded-For',
      `10.78.${Math.floor(syntheticClientAddress / 250)}.${
        (syntheticClientAddress++ % 250) + 1
      }`,
    );

  const jsonResponse = (body: unknown, status = 200) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APPLE_IOS_CLIENT_ID = 'com.dcw.fastque';
    process.env.APPLE_TEAM_ID = 'ABCDE12345';
    process.env.APPLE_KEY_ID = 'FGHIJ67890';
    process.env.APPLE_PRIVATE_KEY = appleClientPrivateKeyPem;
    process.env.TOTP_ENCRYPTION_KEY = `synthetic-apple-e2e-${run}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    (
      app.getHttpAdapter().getInstance() as {
        set(name: string, value: unknown): void;
      }
    ).set('trust proxy', true);
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://appleid.apple.com/auth/keys') {
          return jsonResponse({ keys: [appleJwk] });
        }
        if (url === 'https://appleid.apple.com/auth/token') {
          const body = new URLSearchParams(String(init?.body ?? ''));
          const code = body.get('code') ?? '';
          const exchange = authCodes.get(code);
          if (!exchange) return jsonResponse({ error: 'invalid_grant' }, 400);
          authCodes.delete(code);
          return jsonResponse({
            id_token: exchange.idToken,
            refresh_token: exchange.refreshToken,
          });
        }
        if (url === 'https://appleid.apple.com/auth/revoke') {
          const body = new URLSearchParams(String(init?.body ?? ''));
          const token = body.get('token');
          if (token) revokedRefreshTokens.add(token);
          return jsonResponse({});
        }
        throw new Error('Unexpected outbound request in Apple auth E2E.');
      });
  }, 120_000);

  afterAll(async () => {
    if (fetchSpy) fetchSpy.mockRestore();
    if (app) {
      const [syntheticIdentities, syntheticUsers] = await Promise.all([
        prisma.authIdentity.findMany({
          where: {
            provider: 'APPLE',
            providerSub: { contains: run },
          },
          select: { userId: true },
        }),
        prisma.user.findMany({
          where: { email: { contains: run } },
          select: { id: true },
        }),
      ]);
      const userIds = [
        ...new Set([
          ...fixtureUserIds,
          ...syntheticIdentities.map(({ userId }) => userId),
          ...syntheticUsers.map(({ id }) => id),
        ]),
      ];
      if (userIds.length > 0) {
        await prisma.refreshToken.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.authIdentity.deleteMany({
          where: {
            OR: [
              { userId: { in: userIds } },
              { provider: 'APPLE', providerSub: { contains: run } },
            ],
          },
        });
        await prisma.userRole.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      if (issuedNonces.size > 0) {
        await prisma.appleAuthNonce.deleteMany({
          where: {
            nonceHash: {
              in: [...issuedNonces].map((nonce) =>
                createHash('sha256').update(nonce).digest('hex'),
              ),
            },
          },
        });
      }
      await app.close();
    }
    for (const [name, value] of originalEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }, 120_000);

  async function createNonce(): Promise<string> {
    const response = await withSyntheticClient(
      request(app.getHttpServer()).post(
        `/api/v1/auth/${AUTH_PATHS.appleNonce}`,
      ),
    ).expect(201);
    const nonce = response.body.nonce as string;
    expect(nonce).toHaveLength(43);
    issuedNonces.add(nonce);
    return nonce;
  }

  async function signedAppleToken(
    sub: string,
    nonce: string,
    options: {
      audience?: string;
      issuer?: string;
      expiresIn?: JwtSignOptions['expiresIn'];
      email?: string;
    } = {},
  ): Promise<string> {
    return jwtService.signAsync(
      {
        sub,
        nonce,
        email: options.email ?? `${sub}@privaterelay.appleid.com`,
        email_verified: 'true',
      },
      {
        secret: appleIdPrivateKeyPem,
        algorithm: 'RS256',
        issuer: options.issuer ?? 'https://appleid.apple.com',
        audience: options.audience ?? 'com.dcw.fastque',
        keyid: 'fastque-apple-e2e-key',
        expiresIn: options.expiresIn ?? '5m',
      },
    );
  }

  function authorizeCode(code: string, idToken: string): string {
    const refreshToken = `synthetic-apple-refresh-${run}-${code}`;
    authCodes.set(code, { idToken, refreshToken });
    return refreshToken;
  }

  function login(
    identityToken: string,
    nonce: string,
    authorizationCode: string,
  ) {
    return withSyntheticClient(
      request(app.getHttpServer()).post(`/api/v1/auth/${AUTH_PATHS.apple}`),
    ).send({ identityToken, nonce, authorizationCode });
  }

  it('creates a real customer session only after Apple code-token and client-token identity match', async () => {
    const nonce = await createNonce();
    const email = `apple-customer-${run}@privaterelay.appleid.com`;
    const clientToken = await signedAppleToken(`apple-sub-${run}`, nonce, {
      email,
    });
    const codeToken = await signedAppleToken(`apple-sub-${run}`, nonce, {
      email,
    });
    const refreshToken = authorizeCode(`apple-code-${run}`, codeToken);

    const response = await login(
      clientToken,
      nonce,
      `apple-code-${run}`,
    ).expect(201);
    fixtureUserIds.add(response.body.user.id as string);
    expect(response.body.user).toMatchObject({
      email,
      roles: [Role.CUSTOMER],
      audience: SessionAudience.CUSTOMER,
    });

    const [user, identity, authenticated] = await Promise.all([
      prisma.user.findUnique({
        where: { id: response.body.user.id as string },
        include: { roles: true },
      }),
      prisma.authIdentity.findUnique({
        where: {
          provider_providerSub: {
            provider: 'APPLE',
            providerSub: `apple-sub-${run}`,
          },
        },
      }),
      request(app.getHttpServer())
        .get(`/api/v1/auth/${AUTH_PATHS.me}`)
        .set('Authorization', `Bearer ${response.body.tokens.accessToken}`)
        .expect(200),
    ]);
    expect(user?.roles.map(({ role }) => role)).toContain(Role.CUSTOMER);
    expect(identity?.providerRefreshTokenEncrypted).toBeTruthy();
    expect(identity?.providerRefreshTokenEncrypted).not.toBe(refreshToken);
    expect(authenticated.body.audience).toBe(SessionAudience.CUSTOMER);
  }, 60_000);

  it('links a verified Apple email to the existing account without creating a duplicate user', async () => {
    const email = `apple-link-${run}@example.test`;
    const existing = await prisma.user.create({
      data: {
        email,
        emailVerifiedAt: new Date(),
        status: UserStatus.ACTIVE,
        roles: { create: { role: Role.CUSTOMER } },
      },
    });
    fixtureUserIds.add(existing.id);

    const nonce = await createNonce();
    const sub = `apple-link-sub-${run}`;
    const clientToken = await signedAppleToken(sub, nonce, { email });
    const codeToken = await signedAppleToken(sub, nonce, { email });
    authorizeCode(`apple-link-code-${run}`, codeToken);

    const response = await login(
      clientToken,
      nonce,
      `apple-link-code-${run}`,
    ).expect(201);
    expect(response.body.user.id).toBe(existing.id);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(
      await prisma.authIdentity.count({
        where: { userId: existing.id, provider: 'APPLE', providerSub: sub },
      }),
    ).toBe(1);
  }, 60_000);

  it.each(invalidAppleTokenCases)(
    'rejects an Apple token with %s before exchanging a code',
    async (_label, literal, options) => {
      const nonce = await createNonce();
      const token =
        literal ??
        (await signedAppleToken(`invalid-sub-${run}`, nonce, options));
      const before = authCodes.size;

      await login(token, nonce, `unused-code-${run}-${before}`).expect(401);

      expect(authCodes.size).toBe(before);
      expect(
        await prisma.authIdentity.count({
          where: { provider: 'APPLE', providerSub: `invalid-sub-${run}` },
        }),
      ).toBe(0);
    },
    60_000,
  );

  it('rejects a code bound to a different Apple subject and revokes its unclaimed refresh token', async () => {
    const nonce = await createNonce();
    const clientToken = await signedAppleToken(`client-sub-${run}`, nonce);
    const codeToken = await signedAppleToken(`code-sub-${run}`, nonce);
    const refreshToken = authorizeCode(`mismatch-code-${run}`, codeToken);

    await login(clientToken, nonce, `mismatch-code-${run}`).expect(401);

    expect(revokedRefreshTokens.has(refreshToken)).toBe(true);
    expect(
      await prisma.authIdentity.count({
        where: {
          provider: 'APPLE',
          providerSub: { in: [`client-sub-${run}`, `code-sub-${run}`] },
        },
      }),
    ).toBe(0);
  }, 60_000);

  it('consumes the Apple nonce once and revokes a second unclaimed authorization on replay', async () => {
    const nonce = await createNonce();
    const sub = `apple-replay-sub-${run}`;
    const email = `apple-replay-${run}@privaterelay.appleid.com`;
    const clientToken = await signedAppleToken(sub, nonce, { email });
    const firstCode = `apple-replay-first-${run}`;
    const firstCodeToken = await signedAppleToken(sub, nonce, { email });
    authorizeCode(firstCode, firstCodeToken);
    const first = await login(clientToken, nonce, firstCode).expect(201);
    fixtureUserIds.add(first.body.user.id as string);

    const replayCode = `apple-replay-second-${run}`;
    const replayRefreshToken = authorizeCode(
      replayCode,
      await signedAppleToken(sub, nonce, { email }),
    );
    await login(clientToken, nonce, replayCode).expect(401);

    expect(revokedRefreshTokens.has(replayRefreshToken)).toBe(true);
    expect(
      await prisma.authIdentity.count({
        where: { provider: 'APPLE', providerSub: sub },
      }),
    ).toBe(1);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  }, 60_000);
});
