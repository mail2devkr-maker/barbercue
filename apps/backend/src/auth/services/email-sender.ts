import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuthErrorCode } from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * Swappable delivery boundary shared by recovery and invitations. Development captures links;
 * production is explicitly fail-closed until an approved transactional provider is bound.
 */
export interface EmailSender {
  /** Fails before account lookup/write when the configured transport cannot deliver. */
  assertAvailable(): void;
  sendPasswordReset(
    email: string,
    resetUrl: string,
    expiresInMinutes: number,
  ): Promise<void>;
  sendStaffInvitation(
    email: string,
    setupUrl: string,
    expiresInDays: number,
  ): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

@Injectable()
export class ConsoleEmailSender implements EmailSender {
  private readonly logger = new Logger('EmailSender (development capture)');

  assertAvailable(): void {}

  sendPasswordReset(
    email: string,
    resetUrl: string,
    expiresInMinutes: number,
  ): Promise<void> {
    this.logger.warn(
      `Development password-reset capture for ${email}: ${resetUrl} (valid ${expiresInMinutes} minutes).`,
    );
    return Promise.resolve();
  }

  sendStaffInvitation(
    email: string,
    setupUrl: string,
    expiresInDays: number,
  ): Promise<void> {
    this.logger.warn(
      `Development staff-invitation capture for ${email}: ${setupUrl} (valid ${expiresInDays} days).`,
    );
    return Promise.resolve();
  }
}

/** Production fails truthfully until an explicitly approved transactional transport is bound. */
@Injectable()
export class UnavailableProductionEmailSender implements EmailSender {
  assertAvailable(): never {
    throw new AppException(
      AuthErrorCode.EMAIL_DELIVERY_UNAVAILABLE,
      'Email delivery is temporarily unavailable. Please try again later.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  sendPasswordReset(): Promise<void> {
    this.assertAvailable();
  }

  sendStaffInvitation(): Promise<void> {
    this.assertAvailable();
  }
}
