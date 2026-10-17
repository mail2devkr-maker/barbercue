import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  BookingErrorCode,
  SALON_DESCRIPTION_SUGGESTION_LIMITS,
  SalonDescriptionErrorCode,
  salonDescriptionSuggestionSchema,
  type SalonDescriptionSuggestionDto,
  type SalonDescriptionSuggestionInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { AppException } from '../common/exceptions/app.exception';
import {
  DESCRIPTION_SUGGESTION_PROVIDER,
  type DescriptionSuggestionProvider,
  type SalonDescriptionPrompt,
} from './description-suggestion-provider';

@Injectable()
export class SalonDescriptionService {
  private readonly logger = new Logger(SalonDescriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    @Inject(DESCRIPTION_SUGGESTION_PROVIDER)
    private readonly provider: DescriptionSuggestionProvider,
  ) {}

  async suggest(
    userId: string,
    salonId: string,
    input: SalonDescriptionSuggestionInput,
  ): Promise<SalonDescriptionSuggestionDto> {
    const validated = salonDescriptionSuggestionSchema.parse(input);
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        name: true,
        description: true,
        city: { select: { name: true } },
        services: {
          where: { isActive: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: SALON_DESCRIPTION_SUGGESTION_LIMITS.maxServices,
          select: { name: true },
        },
      },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const prompt: SalonDescriptionPrompt = {
      ...validated,
      salonName: salon.name.slice(
        0,
        SALON_DESCRIPTION_SUGGESTION_LIMITS.maxSalonNameLength,
      ),
      cityName: salon.city.name.slice(
        0,
        SALON_DESCRIPTION_SUGGESTION_LIMITS.maxCityNameLength,
      ),
      currentDescription:
        salon.description?.slice(
          0,
          SALON_DESCRIPTION_SUGGESTION_LIMITS.maxCurrentDescriptionLength,
        ) ?? null,
      activeServiceNames: salon.services.map((service) =>
        service.name.slice(
          0,
          SALON_DESCRIPTION_SUGGESTION_LIMITS.maxServiceNameLength,
        ),
      ),
    };
    if (
      JSON.stringify(prompt).length >
      SALON_DESCRIPTION_SUGGESTION_LIMITS.maxPromptCharacters
    ) {
      throw new AppException(
        SalonDescriptionErrorCode.INPUT_TOO_LARGE,
        'The shop details exceed the suggestion limit. Please write the description manually.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.suggestWithTimeout(prompt);
    const draft = typeof result === 'string' ? result.trim() : '';
    const valid =
      draft.length >= SALON_DESCRIPTION_SUGGESTION_LIMITS.minDraftLength &&
      draft.length <= SALON_DESCRIPTION_SUGGESTION_LIMITS.maxDraftLength &&
      !/[<>]/.test(draft) &&
      !/(https?:\/\/|www\.)/i.test(draft) &&
      !Array.from(draft).some((character) => {
        const code = character.charCodeAt(0);
        return (
          (code >= 0x00 && code <= 0x08) ||
          code === 0x0b ||
          code === 0x0c ||
          (code >= 0x0e && code <= 0x1f)
        );
      });
    if (!valid) {
      throw new AppException(
        SalonDescriptionErrorCode.INVALID_PROVIDER_RESPONSE,
        'The suggestion could not be validated. Please write the description manually.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return {
      draft,
      language: validated.language,
      persisted: false,
      requiresOwnerReview: true,
      notice:
        'AI-generated draft: verify every statement and save it yourself. This suggestion has not changed your shop profile.',
    };
  }

  private async suggestWithTimeout(
    prompt: SalonDescriptionPrompt,
  ): Promise<string> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const providerRequest = Promise.resolve().then(() =>
      this.provider.suggest(prompt, controller.signal),
    );
    const timeoutRequest = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(
          new AppException(
            SalonDescriptionErrorCode.PROVIDER_TIMEOUT,
            'Description suggestions timed out. Please try again or write the description manually.',
            HttpStatus.GATEWAY_TIMEOUT,
          ),
        );
      }, SALON_DESCRIPTION_SUGGESTION_LIMITS.providerTimeoutMs);
    });

    try {
      return await Promise.race([providerRequest, timeoutRequest]);
    } catch (error) {
      if (error instanceof AppException) throw error;
      // Owner content can be private; never log prompts or raw provider payloads.
      this.logger.error(
        'Description suggestion provider failed; payload omitted.',
      );
      throw new AppException(
        SalonDescriptionErrorCode.GENERATION_FAILED,
        'Description suggestions are temporarily unavailable. Please write the description manually.',
        HttpStatus.BAD_GATEWAY,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
