import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuthErrorCode } from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';
import type { OtpSender } from './otp-sender';

const TWO_FACTOR_BASE_URL = 'https://2factor.in/API/V1';

interface TwoFactorResponse {
  Status?: string;
  Details?: string;
}

/**
 * Production OTP delivery via 2Factor.in's "custom OTP" SMS endpoint. OtpService remains the
 * single OTP authority — it generates, hashes, stores, and expires the code (see otp.service.ts);
 * this sender's only job is transporting that already-generated code over SMS. Deliberately does
 * NOT use 2Factor's AUTOGEN/VERIFY flow, which would have 2Factor generate and hold its own OTP
 * value server-side — that would create a second, competing source of truth and make our own
 * hashing/expiry/attempt-limiting meaningless.
 *
 * Endpoint (confirmed against 2Factor's public docs and multiple independent integration
 * write-ups, since no live account/API key exists in this repo to test against directly):
 *   GET https://2factor.in/API/V1/{api_key}/SMS/{phone}/{otp}
 * Response shape is consistent across every 2Factor endpoint: `{ "Status": "Success" | "Error",
 * "Details": string }`. VERIFY BEFORE RELYING ON THIS IN PRODUCTION: confirm this exact request
 * shape against the live 2Factor dashboard/docs for your account, and check whether your account
 * requires a DLT-registered SMS template (a common requirement for Indian transactional SMS,
 * independent of this integration) — see README/DEPLOYMENT.md.
 */
@Injectable()
export class TwoFactorOtpSender implements OtpSender {
  private readonly logger = new Logger(TwoFactorOtpSender.name);

  async sendOtp(phone: string, code: string): Promise<void> {
    const apiKey = process.env.OTP_PROVIDER_API_KEY;
    if (!apiKey) {
      // Never logs the (absent) key value — just the fact that configuration is missing.
      this.logger.error(
        'OTP_PROVIDER_API_KEY is not configured; cannot send SMS via 2Factor.',
      );
      throw this.deliveryFailed();
    }

    const providerPhone = toTwoFactorPhone(phone);
    const url = `${TWO_FACTOR_BASE_URL}/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(providerPhone)}/${encodeURIComponent(code)}`;

    let response: Response;
    try {
      response = await fetch(url, { method: 'GET' });
    } catch (err) {
      // Network-level failure (DNS/timeout/connection refused). Never log `url` — it embeds the
      // API key — log only the failure kind.
      this.logger.error(
        `2Factor SMS request failed before a response was received: ${err instanceof Error ? err.message : 'unknown network error'}`,
      );
      throw this.deliveryFailed();
    }

    let body: TwoFactorResponse | null = null;
    try {
      body = (await response.json()) as TwoFactorResponse;
    } catch {
      body = null;
    }

    if (!response.ok || body?.Status !== 'Success') {
      // Log the provider's own status/details for debugging — never the API key, never the
      // OTP-bearing request URL, and per the security requirement, not the full OTP either.
      this.logger.error(
        `2Factor SMS delivery failed (HTTP ${response.status}): ${body?.Details ?? 'no response body'}`,
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

function toTwoFactorPhone(phone: string): string {
  // Our own stored/validated format is E.164 with a leading "+" (see otpRequestSchema in
  // packages/shared) — this only affects the outbound provider request, never how the phone
  // number is stored or compared anywhere else in the application. A leading "+" is stripped
  // rather than percent-encoded: 2Factor's documented format for Indian numbers is the bare
  // country-code-prefixed digit string (e.g. "919876543210"), and a literal unencoded "+" in a
  // URL path segment is a reported gotcha against some SMS-gateway backends of this vintage.
  return phone.startsWith('+') ? phone.slice(1) : phone;
}
