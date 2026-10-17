import {
  ContactConsentSource,
  ContactImportValidationStatus as Status,
} from '@barbercue/shared';
import { SalonContactImportPreviewService } from './salon-contact-import-preview.service';

describe('SalonContactImportPreviewService', () => {
  let service: SalonContactImportPreviewService;
  let salonAccess: { assertOwnerAccess: jest.Mock };

  beforeEach(() => {
    salonAccess = { assertOwnerAccess: jest.fn().mockResolvedValue(undefined) };
    service = new SalonContactImportPreviewService(salonAccess as never);
  });

  it('authorizes the owner, normalizes transiently, and never returns contact PII or enables sending', async () => {
    const phone = '+919876543210';
    const result = await service.preview('owner-1', 'salon-1', {
      contacts: [
        {
          phone,
          consent: {
            granted: true,
            source: ContactConsentSource.VERBAL,
            capturedAt: new Date(Date.now() - 60_000).toISOString(),
          },
        },
        {
          phone: '9876543210',
          consent: {
            granted: true,
            source: ContactConsentSource.IN_PERSON,
            capturedAt: new Date().toISOString(),
          },
        },
      ],
    });

    expect(salonAccess.assertOwnerAccess).toHaveBeenCalledWith(
      'owner-1',
      'salon-1',
    );
    expect(result).toMatchObject({
      previewOnly: true,
      invitationEligibility: 'NOT_EVALUATED',
      dispatchEnabled: false,
      summary: { total: 2, validatedForReview: 1, duplicateInBatch: 1 },
      items: [
        { index: 0, status: Status.VALIDATED_FOR_REVIEW },
        { index: 1, status: Status.DUPLICATE_IN_BATCH },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(phone);
  });

  it('blocks missing or incomplete consent, invalid phone, and future-dated consent', async () => {
    const result = await service.preview('owner-1', 'salon-1', {
      contacts: [
        {
          phone: '+919876543210',
        },
        {
          phone: '+919811122233',
          consent: { granted: true },
        },
        {
          phone: 'not a phone',
        },
        {
          phone: '+919911122233',
          consent: {
            granted: true,
            source: ContactConsentSource.WRITTEN,
            capturedAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      ],
    });
    expect(result.items.map(({ status }) => status)).toEqual([
      Status.CONSENT_REQUIRED,
      Status.CONSENT_EVIDENCE_INCOMPLETE,
      Status.INVALID_PHONE,
      Status.CONSENT_TIMESTAMP_INVALID,
    ]);
    expect(result.summary).toEqual({
      total: 4,
      validatedForReview: 0,
      invalidPhone: 1,
      consentRequired: 1,
      consentEvidenceIncomplete: 1,
      consentTimestampInvalid: 1,
      duplicateInBatch: 0,
    });
  });

  it('does not process a batch until the target salon owner is authorized', async () => {
    salonAccess.assertOwnerAccess.mockRejectedValue(new Error('forbidden'));
    await expect(
      service.preview('other-user', 'salon-1', {
        contacts: [
          {
            phone: '+919876543210',
          },
        ],
      }),
    ).rejects.toThrow('forbidden');
  });
});
