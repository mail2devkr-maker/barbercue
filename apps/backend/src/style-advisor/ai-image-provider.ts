import { HairstylePreviewDto } from '@barbercue/shared';

/**
 * Swappable hairstyle-preview generation — same seam as auth/services/otp-sender.ts's OtpSender.
 * No image-generation vendor is contracted yet (see the major-upgrade plan's AI provider
 * research: Google Gemini 2.5 Flash Image recommended, not activated without cost approval), so
 * the only implementation registered today is UnconfiguredAiImageProvider, which always throws.
 * Wiring a real provider later means adding one new class here and flipping the factory in
 * style-advisor.module.ts — nothing about the controller/service or the request/response
 * contract changes.
 */
export interface AiImageProvider {
  generate(image: Buffer, mimeType: string): Promise<HairstylePreviewDto[]>;
}

export const AI_IMAGE_PROVIDER = Symbol('AI_IMAGE_PROVIDER');
