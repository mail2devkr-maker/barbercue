import { HttpStatus } from '@nestjs/common';
import { SALON_DESCRIPTION_SUGGESTION_LIMITS } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import {
  DescriptionSuggestionProvider,
  SalonDescriptionPrompt,
} from './description-suggestion-provider';
import { SalonDescriptionService } from './salon-description.service';
import { UnconfiguredDescriptionSuggestionProvider } from './unconfigured-description-suggestion-provider';

const SALON_ID = '8a76c495-d31b-4c91-bba0-82b27d2b83c1';
const validDraft =
  'A welcoming neighborhood salon offering careful haircuts and grooming with friendly service. Our team takes time to understand each guest’s preferences and provide a comfortable visit.';

describe('SalonDescriptionService', () => {
  let service: SalonDescriptionService;
  let prisma: { salon: { findUnique: jest.Mock } };
  let access: { assertOwnerAccess: jest.Mock };
  let provider: { suggest: jest.Mock };

  const salon = {
    name: 'Synthetic Salon',
    description: 'Owner-entered facts only.',
    city: { name: 'Sample City' },
    services: [{ name: 'Haircut' }, { name: 'Beard trim' }],
  };

  beforeEach(() => {
    jest.useRealTimers();
    prisma = { salon: { findUnique: jest.fn().mockResolvedValue(salon) } };
    access = { assertOwnerAccess: jest.fn().mockResolvedValue(undefined) };
    provider = { suggest: jest.fn().mockResolvedValue(validDraft) };
    service = new SalonDescriptionService(
      prisma as unknown as PrismaService,
      access as unknown as SalonAccessService,
      provider as unknown as DescriptionSuggestionProvider,
    );
  });

  it('rechecks salon ownership and sends only salon facts plus bounded owner highlights', async () => {
    const result = await service.suggest('owner-1', SALON_ID, {
      language: 'en',
      tone: 'friendly',
      ownerAttestedHighlights: ['Walkable location'],
    });
    expect(access.assertOwnerAccess).toHaveBeenCalledWith('owner-1', SALON_ID);
    expect(provider.suggest).toHaveBeenCalledWith(
      {
        language: 'en',
        tone: 'friendly',
        salonName: salon.name,
        cityName: salon.city.name,
        currentDescription: salon.description,
        activeServiceNames: ['Haircut', 'Beard trim'],
        ownerAttestedHighlights: ['Walkable location'],
      },
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      draft: validDraft,
      persisted: false,
      requiresOwnerReview: true,
    });
  });

  it('never reads salon data or calls a provider when owner authorization fails', async () => {
    access.assertOwnerAccess.mockRejectedValue(new Error('forbidden'));
    await expect(
      service.suggest('intruder', SALON_ID, {
        language: 'en',
        tone: 'professional',
        ownerAttestedHighlights: [],
      }),
    ).rejects.toThrow('forbidden');
    expect(prisma.salon.findUnique).not.toHaveBeenCalled();
    expect(provider.suggest).not.toHaveBeenCalled();
  });

  it('maps provider timeout to 504 and aborts the provider signal', async () => {
    jest.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    provider.suggest.mockImplementation(
      (_prompt: SalonDescriptionPrompt, signal: AbortSignal) => {
        receivedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    );
    const pending = service.suggest('owner-1', SALON_ID, {
      language: 'en',
      tone: 'professional',
      ownerAttestedHighlights: [],
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'SALON_DESCRIPTION_PROVIDER_TIMEOUT',
    });
    await jest.advanceTimersByTimeAsync(
      SALON_DESCRIPTION_SUGGESTION_LIMITS.providerTimeoutMs,
    );
    await assertion;
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('rejects markup, URLs and unsupported provider output length', async () => {
    provider.suggest.mockResolvedValue('<script>alert(1)</script>');
    await expect(
      service.suggest('owner-1', SALON_ID, {
        language: 'en',
        tone: 'professional',
        ownerAttestedHighlights: [],
      }),
    ).rejects.toMatchObject({
      code: 'SALON_DESCRIPTION_INVALID_PROVIDER_RESPONSE',
      status: HttpStatus.BAD_GATEWAY,
    });
  });

  it('uses a default provider that fails closed instead of inventing a suggestion', async () => {
    const unconfigured = new SalonDescriptionService(
      prisma as unknown as PrismaService,
      access as unknown as SalonAccessService,
      new UnconfiguredDescriptionSuggestionProvider(),
    );
    await expect(
      unconfigured.suggest('owner-1', SALON_ID, {
        language: 'en',
        tone: 'professional',
        ownerAttestedHighlights: [],
      }),
    ).rejects.toMatchObject({
      code: 'SALON_DESCRIPTION_PROVIDER_NOT_CONFIGURED',
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});
