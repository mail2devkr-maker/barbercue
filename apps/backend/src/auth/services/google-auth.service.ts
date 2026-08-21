import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { AuthErrorCode } from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';

export interface VerifiedGoogleIdentity {
  /** Google's stable subject identifier — the actual identity key, never the email. */
  sub: string;
  /** Only ever populated when Google itself reports the email as verified; otherwise null, so a
   * caller can never accidentally use an unverified email for account linking. */
  email: string | null;
  name: string | null;
}

/**
 * Verifies a Google ID token server-side — the client never gets to assert its own identity, only
 * hand over a token Google itself signed. Uses `google-auth-library` (Google's own official
 * package), never a hand-rolled JWT check against Google's public keys.
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly client = new OAuth2Client();

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    // Both the web and Android OAuth clients are first-party BarberCue clients sharing this one
    // backend — Google's own guidance for a multi-platform app is to accept either as a valid
    // audience, not to run two separate verifiers.
    const audiences = [
      process.env.GOOGLE_WEB_CLIENT_ID,
      process.env.GOOGLE_ANDROID_CLIENT_ID,
    ].filter((v): v is string => Boolean(v));

    if (audiences.length === 0) {
      this.logger.error(
        'Neither GOOGLE_WEB_CLIENT_ID nor GOOGLE_ANDROID_CLIENT_ID is configured; cannot verify Google sign-in.',
      );
      throw this.invalidToken();
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: audiences,
      });
      payload = ticket.getPayload();
    } catch (err) {
      // Never logs the token itself — only the failure kind (expired/malformed/wrong
      // issuer/signature mismatch are all folded into one generic client-facing error).
      this.logger.error(
        `Google ID token verification failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw this.invalidToken();
    }

    if (!payload?.sub) {
      throw this.invalidToken();
    }

    return {
      sub: payload.sub,
      // Only trust the email if Google itself marks it verified — otherwise treat it as absent
      // rather than rejecting the whole sign-in (the sub alone is a fully valid identity).
      email: payload.email_verified === true ? (payload.email ?? null) : null,
      name: payload.name ?? null,
    };
  }

  private invalidToken(): AppException {
    return new AppException(
      AuthErrorCode.GOOGLE_TOKEN_INVALID,
      'Could not verify your Google sign-in. Please try again.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
