import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import { AuthErrorCode } from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_NONCE_TTL_MS = 5 * 60 * 1000;
const APPLE_JWKS_CACHE_MS = 60 * 60 * 1000;

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
}
