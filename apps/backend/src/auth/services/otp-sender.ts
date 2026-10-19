import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthErrorCode } from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * Swappable OTP delivery — code generation and verification remain provider-independent. The
 * unavailable default fails closed; it never writes phone numbers or OTP values to logs.
 */
export interface OtpSender {
  sendOtp(phone: string, code: string): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

@Injectable()
export class UnavailableOtpSender implements OtpSender {
  sendOtp(): Promise<void> {
    return Promise.reject(
      new AppException(
        AuthErrorCode.OTP_DELIVERY_FAILED,
        'Phone verification is temporarily unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
    );
  }
}
