import { Injectable } from '@nestjs/common';
import { generate, generateSecret, generateURI, verify } from 'otplib';

// RFC 6238 TOTP — real generation/verification (otplib), not a stub. epochTolerance allows a
// ±30s clock-drift window, otplib's documented "standard" setting for most 2FA implementations.
const EPOCH_TOLERANCE_SECONDS = 30;

@Injectable()
export class TotpService {
  generateSecret(): string {
    return generateSecret();
  }

  generateToken(secret: string): Promise<string> {
    return generate({ secret });
  }

  async verifyToken(secret: string, token: string): Promise<boolean> {
    const result = await verify({
      secret,
      token,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    });
    return result.valid;
  }

  buildOtpAuthUri(accountLabel: string, secret: string): string {
    return generateURI({ issuer: 'BarberCue', label: accountLabel, secret });
  }
}
