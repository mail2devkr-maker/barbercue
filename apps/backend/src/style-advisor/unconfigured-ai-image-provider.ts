import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HairstylePreviewDto, StyleAdvisorErrorCode } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { AiImageProvider } from './ai-image-provider';

/**
 * The only AiImageProvider registered today (see ai-image-provider.ts). Always fails clearly and
 * safely — never returns a fabricated preview image or a fake match percentage. Mirrors
 * TwoFactorOtpSender's "throw a clear, typed error when unconfigured" precedent rather than
 * silently degrading. Logs a single line (no image data, no request payload) so an operator can
 * see the feature was attempted without anything sensitive hitting the logs.
 */
@Injectable()
export class UnconfiguredAiImageProvider implements AiImageProvider {
  private readonly logger = new Logger(
    'AiImageProvider (unconfigured — no image-generation provider wired)',
  );

  generate(): Promise<HairstylePreviewDto[]> {
    this.logger.warn(
      'AI Style Advisor was invoked but no AiImageProvider is configured — see style-advisor.module.ts / ARCHITECTURE.md §19 for the current provider decision (Gemini requires paid billing, no verified free alternative is wired).',
    );
    throw new AppException(
      StyleAdvisorErrorCode.AI_PROVIDER_NOT_CONFIGURED,
      // Truthful, not "busy"/"try again" — the real reason is that no image-generation provider is
      // configured yet, not rate limiting. Never mentions the provider name, quota, or HTTP status.
      'AI Style Preview is temporarily unavailable while we prepare the image-generation service. Your photo was not stored.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
