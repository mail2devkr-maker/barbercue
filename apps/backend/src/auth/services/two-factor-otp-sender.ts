import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuthErrorCode } from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';
import type { OtpSender } from './otp-sender';

const TWO_FACTOR_SEND_URL = 'https://2factor.in/API/V1/OTP/SEND';
const PROVIDER_TIMEOUT_MS = 8_000;

interface TwoFactorSendResponse {
  status?: string;
  session_id?: string;
}

/**
 * Transports the app-generated OTP through 2Factor's documented template-based send API. The
 * provider accepts/queues the request; actual handset delivery is not certified by this response
 * and requires an account DLR/receipt check. The API key is sent only in a header, never in a URL.
 */
@Injectable()
export class TwoFactorOtpSender implements OtpSender {
  private readonly logger = new Logger(TwoFactorOtpSender.name);

  async sendOtp(phone: string, code: string): Promise<void> {
    const apiKey = process.env.OTP_PROVIDER_API_KEY?.trim();
    const templateName = process.env.OTP_PROVIDER_TEMPLATE_NAME?.trim();
    if (
      !apiKey ||
      !templateName ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(templateName)
    ) {
      this.logger.error('2Factor OTP transport is not fully configured.');
      throw this.deliveryFailed();
    }

    let response: Response;
    try {
      response = await fetch(TWO_FACTOR_SEND_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          to: phone,
          template_name: templateName,
          var1: code,
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch {
      // Do not include error messages: fetch errors can include request details and provider data.
      this.logger.error('2Factor OTP request failed before an HTTP response.');
      throw this.deliveryFailed();
    }

    let body: TwoFactorSendResponse | null = null;
    try {
      body = (await response.json()) as TwoFactorSendResponse;
    } catch {
      // The provider response body is deliberately not logged or returned to the caller.
    }

    if (!response.ok || body?.status?.toLowerCase() !== 'sent') {
      this.logger.error(
        `2Factor OTP request was not accepted (HTTP ${response.status}).`,
      );
      throw this.deliveryFailed();
    }
  }

  private deliveryFailed(): AppException {
    return new AppException(
      AuthErrorCode.OTP_DELIVERY_FAILED,
      'Could not send the verification code. Please try again in a moment.',
      HttpStatus.BAD_GATEWAY,
    );
  }
}
