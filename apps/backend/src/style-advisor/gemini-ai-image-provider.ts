import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI, ApiError as GeminiApiError } from '@google/genai';
import {
  HAIRSTYLE_CATALOG,
  HairstylePreviewDto,
  StyleAdvisorErrorCode,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { AiImageProvider } from './ai-image-provider';

const MODEL = 'gemini-2.5-flash-image';

// Fixed set of 3 catalog styles previewed per request. Not a personalized recommendation — Gemini
// generates an edited photo for each of these fixed styles, it does not choose them. A future
// phase could add real face-shape analysis to personalize this list; today it's deliberately the
// smallest reasonable "3 previews" the task calls for, not the full 8-entry catalog (cost control).
const PREVIEW_STYLE_IDS = ['fade', 'textured-quiff', 'undercut'] as const;

// Fixed, documented presentation/ranking score — NOT an AI-measured similarity or accuracy metric.
// Gemini's image API returns no such score; this exists only so the UI has a differentiated
// ranking to display, and is worded in the frontend as "AI Style Match", never "best match".
const PRESENTATION_MATCH_PERCENTS: Record<
  (typeof PREVIEW_STYLE_IDS)[number],
  number
> = {
  fade: 91,
  'textured-quiff': 86,
  undercut: 81,
};

function buildPrompt(styleName: string): string {
  return [
    'You are helping a barbershop customer preview a new haircut before booking, by editing the',
    'attached photo of a real person.',
    '',
    `Give this exact person a "${styleName}" hairstyle.`,
    '',
    'Strict requirements:',
    "- Preserve this exact person's face, identity, skin tone, and facial proportions exactly.",
    '  Do not replace their face or generate a different person.',
    '- Change only the hair to a realistic, well-groomed, salon-appropriate "' +
      styleName +
      '" cut.',
    '- The result must look like a real, unedited photograph — no cartoon, sketch, or painting style.',
    '- Do not add any text, captions, logos, or watermarks anywhere in the image.',
    '- Do not add unrelated objects, people, or background changes.',
    '- Return a generated image. Do not respond with only a text description.',
  ].join('\n');
}

/**
 * Real image-generation provider backed by Google's Gemini 2.5 Flash Image model via the official
 * @google/genai SDK. Only ever constructed by style-advisor.module.ts's AI_IMAGE_PROVIDER factory
 * when GEMINI_API_KEY is present — this class assumes a key was already supplied and never checks
 * for its own absence (UnconfiguredAiImageProvider is the fallback for that case).
 *
 * Generates previews sequentially (not Promise.all): if an earlier style's call fails, later
 * styles are never attempted, so a request never pays for generations it's about to discard. Total
 * Gemini calls per request is exactly PREVIEW_STYLE_IDS.length (3) on success, and no more than the
 * number of styles attempted before a failure — no retries, no unbounded generation.
 */
@Injectable()
export class GeminiAiImageProvider implements AiImageProvider {
  private readonly logger = new Logger(GeminiAiImageProvider.name);
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generate(
    image: Buffer,
    mimeType: string,
  ): Promise<HairstylePreviewDto[]> {
    const base64Image = image.toString('base64');
    const results: HairstylePreviewDto[] = [];

    for (const styleId of PREVIEW_STYLE_IDS) {
      const catalogEntry = HAIRSTYLE_CATALOG.find((s) => s.id === styleId);
      if (!catalogEntry) {
        // Defensive only — PREVIEW_STYLE_IDS is a fixed subset of HAIRSTYLE_CATALOG's own ids.
        throw new Error(
          `HAIRSTYLE_CATALOG is missing expected style id "${styleId}"`,
        );
      }
      results.push(
        await this.generateOne(
          catalogEntry.id,
          catalogEntry.name,
          base64Image,
          mimeType,
          PRESENTATION_MATCH_PERCENTS[styleId],
        ),
      );
    }

    return results;
  }

  private async generateOne(
    styleId: string,
    styleName: string,
    base64Image: string,
    mimeType: string,
    matchPercent: number,
  ): Promise<HairstylePreviewDto> {
    let response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;
    try {
      response = await this.client.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { text: buildPrompt(styleName) },
              { inlineData: { mimeType, data: base64Image } },
            ],
          },
        ],
      });
    } catch (err) {
      throw this.toAppException(err, styleName);
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((part) => part.inlineData?.data);

    if (!imagePart?.inlineData?.data) {
      // Never log image/base64 data or the raw SDK response — style name and the fact of failure
      // are the only useful, safe signal here.
      this.logger.error(
        `Gemini returned no image data for style "${styleName}".`,
      );
      throw new AppException(
        StyleAdvisorErrorCode.AI_GENERATION_FAILED,
        "The AI Style Advisor couldn't generate a preview right now. Please try again.",
        HttpStatus.BAD_GATEWAY,
      );
    }

    const outputMimeType = imagePart.inlineData.mimeType ?? 'image/png';
    return {
      styleId,
      styleName,
      previewUrl: `data:${outputMimeType};base64,${imagePart.inlineData.data}`,
      matchPercent,
    };
  }

  private toAppException(err: unknown, styleName: string): AppException {
    const status = err instanceof GeminiApiError ? err.status : undefined;
    // Never log the API key, the request body (it contains the customer's photo), or any raw
    // provider payload — status code and style name only.
    this.logger.error(
      `Gemini generation failed for style "${styleName}" (status: ${status ?? 'unknown'}).`,
    );

    if (status === 429) {
      return new AppException(
        StyleAdvisorErrorCode.AI_RATE_LIMITED,
        'The AI Style Advisor is busy right now. Please try again in a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return new AppException(
      StyleAdvisorErrorCode.AI_GENERATION_FAILED,
      "The AI Style Advisor couldn't generate a preview right now. Please try again.",
      HttpStatus.BAD_GATEWAY,
    );
  }
}
