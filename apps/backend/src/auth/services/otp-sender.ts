import { Injectable, Logger } from '@nestjs/common';

/**
 * Swappable OTP delivery — exactly the seam ARCHITECTURE.md §4 calls for ("OTP delivery is
 * behind a swappable OtpSender interface"). No SMS provider (MSG91/Twilio/etc.) is contracted
 * yet, so the only implementation below logs to the server console instead of sending a real
 * SMS. Everything upstream of delivery — code generation, hashing, expiry, attempt-limiting — is
 * real (see OtpService); only the transport is a dev stand-in, clearly labeled as such.
 */
export interface OtpSender {
  sendOtp(phone: string, code: string): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

@Injectable()
export class ConsoleOtpSender implements OtpSender {
  private readonly logger = new Logger(
    'OtpSender (console — no SMS provider configured)',
  );

  sendOtp(phone: string, code: string): Promise<void> {
    this.logger.warn(
      `OTP for ${phone}: ${code} (valid 5 minutes) — EXTERNAL: wire a real SMS provider here.`,
    );
    return Promise.resolve();
  }
}
