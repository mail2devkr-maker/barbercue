import { Injectable, Logger } from '@nestjs/common';

/**
 * Swappable email delivery for the forgot-password flow. No email provider (SES/SendGrid/etc.)
 * is connected yet — per Phase 2 instructions, the abstraction and the real reset-token
 * lifecycle (generation/hashing/expiry/one-time-use, see AuthService) are fully built; only the
 * transport is a dev stand-in that logs the reset link instead of emailing it.
 */
export interface EmailSender {
  sendPasswordReset(email: string, resetUrl: string): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

@Injectable()
export class ConsoleEmailSender implements EmailSender {
  private readonly logger = new Logger(
    'EmailSender (console — no email provider configured)',
  );

  sendPasswordReset(email: string, resetUrl: string): Promise<void> {
    this.logger.warn(
      `Password reset for ${email}: ${resetUrl} (valid 15 minutes) — EXTERNAL: wire a real email provider here.`,
    );
    return Promise.resolve();
  }
}
