import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuthErrorCode } from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';
import type { OtpSender } from './otp-sender';
import { otpProviderApiMode } from './otp-config';

const TWO_FACTOR_SEND_URL = 'https://2factor.in/API/V1/OTP/SEND';
const TWO_FACTOR_MANUAL_BASE_URL = 'https://2factor.in/API/V1';
const PROVIDER_TIMEOUT_MS = 8_000;

interface TwoFactorSendResponse {
  status?: string;
  session_id?: string;
  Status?: string;
  Details?: string;
}

/**
 * Sends the OTP generated and HMAC-verified by FastQue (OtpService). This never asks 2Factor
 * to AUTOGEN a code: doing so would send a different code from the locally stored challenge.
 *
 * POST mode is the existing transport, with the key in a header. The optional manual-v1 mode
 * supports the vendor's legacy /API/V1/{key}/SMS/{phone}/{sixDigitCode}/{template} contract.
 * That legacy API necessarily puts the key and OTP in the outbound HTTPS URL. Never expose it
 * to a client, log request URLs/errors/responses, follow redirects, or enable HTTP debug traces.
 * A successful provider response means request acceptance, NOT confirmed SMS delivery.
 */
@Injectable()
export class TwoFactorOtpSender implements OtpSender {
  private readonly logger = new Logger(TwoFactorOtpSender.name);

  async sendOtp(phone: string, code: string): Promise<void> {
    const apiKey = process.env.OTP_PROVIDER_API_KEY?.trim();
    const templateName = process.env.OTP_PROVIDER_TEMPLATE_NAME?.trim();
    const mode = otpProviderApiMode();

    if (
      !apiKey ||
      !templateName ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(templateName) ||
      !mode ||
      !/^\+[1-9]\d{7,14}$/.test(phone) ||
      !/^\d{6}$/.test(code)
    ) {
      this.logger.error('2Factor OTP transport has invalid configuration or input.');
      throw this.deliveryFailed();
    }

    // E.164 is retained for POST. The legacy manual API expects the dial code and phone
    // digits without the E.164 plus sign; every URL segment is encoded individually.
    const legacyUrl =
      mode === 'manual-v1'
        ? `${TWO_FACTOR_MANUAL_BASE_URL}/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(phone.slice(1))}/${encodeURIComponent(code)}/${encodeURIComponent(templateName)}`
        : null;

    let response: Response;
    let body: TwoFactorSendResponse | null = null;
    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(),
      PROVIDER_TIMEOUT_MS,
    );
    try {
      response = await fetch(
        legacyUrl ?? TWO_FACTOR_SEND_URL,
        mode === 'manual-v1'
          ? {
              method: 'GET',
              redirect: 'error',
              cache: 'no-store',
              signal: timeoutController.signal,
            }
          : {
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
              signal: timeoutController.signal,
            },
      );
      body = (await response.json()) as TwoFactorSendResponse;
    } catch {
      // Network exceptions, provider body, and URL can contain the API key and live OTP.
      this.logger.error(
        timeoutController.signal.aborted
          ? '2Factor OTP request timed out.'
          : '2Factor OTP request failed before a valid response.',
      );
      throw this.deliveryFailed();
    } finally {
      clearTimeout(timeout);
    }

    const accepted =
      mode === 'manual-v1'
        ? body?.Status === 'Success' &&
          typeof body.Details === 'string' &&
          body.Details.length > 0
        : body?.status?.toLowerCase() === 'sent';

    if (!response.ok || !accepted) {
      // Safe metadata only; never include response body, URL, code, phone or API key.
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
