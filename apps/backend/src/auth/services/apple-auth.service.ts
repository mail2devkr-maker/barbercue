import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
} from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import { AuthErrorCode } from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const APPLE_NONCE_TTL_MS = 5 * 60 * 1000;
const APPLE_JWKS_CACHE_MS = 60 * 60 * 1000;
const APPLE_REQUEST_TIMEOUT_MS = 5_000;

interface AppleServerConfig {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

/** Apple is advertised only when sign-in AND later account-deletion revocation are configured. */
export function isAppleAuthConfigured(): boolean {
  return Boolean(getAppleServerConfig() && process.env.TOTP_ENCRYPTION_KEY);
}

function getAppleServerConfig(): AppleServerConfig | null {
  const clientId = process.env.APPLE_IOS_CLIENT_ID?.trim();
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const keyId = process.env.APPLE_KEY_ID?.trim();
  const configuredKey = process.env.APPLE_PRIVATE_KEY;
  if (
    !clientId ||
    !teamId ||
    !/^[A-Z0-9]{10}$/.test(teamId) ||
    !keyId ||
    !/^[A-Z0-9]{10}$/.test(keyId) ||
    !configuredKey
  ) {
    return null;
  }
  const privateKey = configuredKey.replace(/\\n/g, '\n');
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) return null;
  try {
    const parsedKey = createPrivateKey(privateKey);
    if (
      parsedKey.asymmetricKeyType !== 'ec' ||
      parsedKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return { clientId, teamId, keyId, privateKey };
}

interface AppleJwk {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
}

interface AppleJwksResponse {
  keys?: AppleJwk[];
}

interface AppleIdentityClaims {
  sub: string;
  nonce: string;
  email?: string;
  email_verified?: boolean | string;
}

export interface VerifiedAppleIdentity {
  sub: string;
  email: string | null;
}

/**
 * Apple ID-token verifier and one-use challenge manager. Apple identities are keyed by `sub`,
 * never by a client-asserted email. JWKS are fetched only from Apple's fixed HTTPS endpoint and
 * cached; tokens must pass signature, issuer, audience, expiry, and exact nonce checks.
 */
@Injectable()
export class AppleAuthService {
  private jwksCache: { keys: AppleJwk[]; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async createLoginNonce(): Promise<{ nonce: string; expiresAt: string }> {
    const now = new Date();
    await this.prisma.appleAuthNonce.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + APPLE_NONCE_TTL_MS);
    await this.prisma.appleAuthNonce.create({
      data: { nonceHash: this.hashNonce(nonce), expiresAt },
    });
    return { nonce, expiresAt: expiresAt.toISOString() };
  }

  async consumeLoginNonce(
    tx: Prisma.TransactionClient,
    nonce: string,
  ): Promise<void> {
    const result = await tx.appleAuthNonce.deleteMany({
      where: {
        nonceHash: this.hashNonce(nonce),
        expiresAt: { gt: new Date() },
      },
    });
    if (result.count !== 1) throw this.invalidToken();
  }

  async verifyIdToken(
    identityToken: string,
    expectedNonce: string,
  ): Promise<VerifiedAppleIdentity> {
    const clientId = process.env.APPLE_IOS_CLIENT_ID;
    if (!clientId || expectedNonce.length < 32 || expectedNonce.length > 128) {
      throw this.invalidToken();
    }

    let kid: string;
    try {
      const headerSegment = identityToken.split('.')[0];
      if (!headerSegment) throw new Error('Malformed token');
      const header = JSON.parse(
        Buffer.from(headerSegment, 'base64url').toString('utf8'),
      ) as {
        alg?: string;
        kid?: string;
      };
      if (header.alg !== 'RS256' || !header.kid)
        throw new Error('Unsupported token header');
      kid = header.kid;
    } catch {
      throw this.invalidToken();
    }

    const key = await this.getAppleKey(kid);
    let claims: AppleIdentityClaims;
    try {
      claims = await this.jwtService.verifyAsync<AppleIdentityClaims>(
        identityToken,
        {
          secret: key,
          algorithms: ['RS256'],
          issuer: APPLE_ISSUER,
          audience: clientId,
          clockTolerance: 30,
        },
      );
    } catch {
      throw this.invalidToken();
    }

    if (
      typeof claims.sub !== 'string' ||
      claims.sub.length === 0 ||
      typeof claims.nonce !== 'string' ||
      claims.nonce !== expectedNonce
    ) {
      throw this.invalidToken();
    }

    const verifiedEmail =
      claims.email_verified === true || claims.email_verified === 'true';
    return {
      sub: claims.sub,
      email:
        verifiedEmail && typeof claims.email === 'string' ? claims.email : null,
    };
  }

  /** Exchange Apple's short-lived authorization code; only the encrypted refresh token is stored. */
  async exchangeAuthorizationCode(authorizationCode: string): Promise<string> {
    const config = getAppleServerConfig();
    if (!config || !process.env.TOTP_ENCRYPTION_KEY) {
      throw this.providerUnavailable();
    }
    if (!authorizationCode || authorizationCode.length > 4096) {
      throw this.invalidToken();
    }
    const clientSecret = await this.createClientSecret(config);
    const payload = await this.postForm(APPLE_TOKEN_URL, {
      client_id: config.clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    });
    if (typeof payload.refresh_token !== 'string' || !payload.refresh_token) {
      throw this.providerUnavailable();
    }
    return payload.refresh_token;
  }

  /** Revoke the retained Apple refresh token before local account deletion commits. */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const config = getAppleServerConfig();
    if (!config || !process.env.TOTP_ENCRYPTION_KEY || !refreshToken) {
      throw this.providerUnavailable();
    }
    const clientSecret = await this.createClientSecret(config);
    await this.postForm(
      APPLE_REVOKE_URL,
      {
        client_id: config.clientId,
        client_secret: clientSecret,
        token: refreshToken,
        token_type_hint: 'refresh_token',
      },
      false,
    );
  }

  private async createClientSecret(config: AppleServerConfig): Promise<string> {
    try {
      return await this.jwtService.signAsync(
        {},
        {
          secret: config.privateKey,
          algorithm: 'ES256',
          issuer: config.teamId,
          subject: config.clientId,
          audience: APPLE_ISSUER,
          expiresIn: '5m',
          keyid: config.keyId,
        },
      );
    } catch {
      throw this.providerUnavailable();
    }
  }

  private async postForm(
    url: string,
    fields: Record<string, string>,
    requireJson = true,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      APPLE_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: new URLSearchParams(fields),
        signal: controller.signal,
      });
      if (!response.ok) throw this.providerUnavailable();
      if (!requireJson) return {};
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!payload || typeof payload !== 'object') {
        throw this.providerUnavailable();
      }
      return payload as Record<string, unknown>;
    } catch (error) {
      if (error instanceof AppException) throw error;
      // Never propagate Apple response bodies, authorization codes, or token values to logs/errors.
      throw this.providerUnavailable();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getAppleKey(kid: string): Promise<string> {
    let keys = await this.getAppleJwks(false);
    let jwk = keys.find((key) => key.kid === kid);
    if (!jwk) {
      keys = await this.getAppleJwks(true);
      jwk = keys.find((key) => key.kid === kid);
    }
    if (
      !jwk ||
      jwk.kty !== 'RSA' ||
      (jwk.use && jwk.use !== 'sig') ||
      (jwk.alg && jwk.alg !== 'RS256') ||
      !jwk.n ||
      !jwk.e
    ) {
      throw this.invalidToken();
    }
    try {
      return createPublicKey({
        key: jwk as unknown as import('node:crypto').JsonWebKey,
        format: 'jwk',
      })
        .export({ format: 'pem', type: 'spki' })
        .toString();
    } catch {
      throw this.invalidToken();
    }
  }

  private async getAppleJwks(forceRefresh: boolean): Promise<AppleJwk[]> {
    if (
      !forceRefresh &&
      this.jwksCache &&
      this.jwksCache.expiresAt > Date.now()
    ) {
      return this.jwksCache.keys;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(APPLE_JWKS_URL, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Apple key service unavailable');
      const body = (await response.json()) as AppleJwksResponse;
      if (!Array.isArray(body.keys) || body.keys.length === 0) {
        throw new Error('Apple key set is empty');
      }
      this.jwksCache = {
        keys: body.keys,
        expiresAt: Date.now() + APPLE_JWKS_CACHE_MS,
      };
      return body.keys;
    } catch {
      throw this.invalidToken();
    } finally {
      clearTimeout(timeout);
    }
  }

  private hashNonce(nonce: string): string {
    return createHash('sha256').update(nonce).digest('hex');
  }

  private invalidToken(): AppException {
    return new AppException(
      AuthErrorCode.APPLE_TOKEN_INVALID,
      'Could not verify your Apple sign-in. Please try again.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private providerUnavailable(): AppException {
    return new AppException(
      AuthErrorCode.APPLE_PROVIDER_UNAVAILABLE,
      'Apple sign-in is temporarily unavailable. Please try again later.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
