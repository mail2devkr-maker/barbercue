import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { HairstylePreviewDto, StyleAdvisorErrorCode } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { AiCreditService } from '../premium/ai-credit.service';
import { AI_IMAGE_PROVIDER, AiImageProvider } from './ai-image-provider';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — a phone selfie comfortably fits well under this.
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class StyleAdvisorService {
  constructor(
    @Inject(AI_IMAGE_PROVIDER)
    private readonly provider: AiImageProvider,
    private readonly aiCredits: AiCreditService,
  ) {}

  /**
   * `file` is validated here — before it ever reaches the provider — so a bad upload fails fast
   * with a clear client error instead of an opaque provider-side failure. The image buffer lives
   * only in this call's memory (see StyleAdvisorController's multer config: memoryStorage, never
   * disk) and is discarded the moment this method returns; nothing here writes it anywhere.
   *
   * Premium phase: an AI credit is reserved (AiCreditService.reserveCredit — throws
   * PREMIUM_REQUIRED / AI_CREDITS_EXHAUSTED for a non-Premium or out-of-credits customer) BEFORE
   * the provider is ever called, and is consumed on success or released on any failure — a
   * customer is never charged a credit for a generation that didn't happen.
   */
  async generate(
    userId: string,
    file: Express.Multer.File | undefined,
  ): Promise<HairstylePreviewDto[]> {
    if (!file) {
      throw new AppException(
        StyleAdvisorErrorCode.IMAGE_REQUIRED,
        'Please upload a photo to continue.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || file.size > MAX_IMAGE_BYTES) {
      throw new AppException(
        StyleAdvisorErrorCode.INVALID_IMAGE,
        'Please upload a JPEG, PNG, or WebP photo under 5MB.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const subscriptionId = await this.aiCredits.reserveCredit(userId);
    try {
      const results = await this.provider.generate(file.buffer, file.mimetype);
      await this.aiCredits.consumeCredit(subscriptionId);
      return results;
    } catch (err) {
      await this.aiCredits.releaseCredit(subscriptionId);
      throw err;
    }
  }
}
