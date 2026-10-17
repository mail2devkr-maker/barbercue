import { Injectable } from '@nestjs/common';
import {
  ContactImportValidationStatus as Status,
  normalizeContactPhone,
  type SalonContactImportPreviewDto,
  type SalonContactImportPreviewInput,
} from '@barbercue/shared';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

/**
 * D13's safe first increment. This is a transient validation preview, not a contact importer or
 * invitation sender: it never persists contact PII, checks whether a phone has an account, or
 * invokes an SMS/email provider. Consent source/time are owner-attested input, not proof by
 * themselves. Therefore invitation eligibility intentionally remains NOT_EVALUATED until a
 * durable consent/suppression ledger and approved delivery workflow exist.
 */
@Injectable()
export class SalonContactImportPreviewService {
  constructor(private readonly salonAccess: SalonAccessService) {}

  async preview(
    userId: string,
    salonId: string,
    input: SalonContactImportPreviewInput,
  ): Promise<SalonContactImportPreviewDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);

    const now = Date.now();
    const seenPhones = new Set<string>();
    const summary: SalonContactImportPreviewDto['summary'] = {
      total: input.contacts.length,
      validatedForReview: 0,
      invalidPhone: 0,
      consentRequired: 0,
      consentEvidenceIncomplete: 0,
      consentTimestampInvalid: 0,
      duplicateInBatch: 0,
    };

    const items = input.contacts.map((contact, index) => {
      const phone = normalizeContactPhone(contact.phone);
      let status: SalonContactImportPreviewDto['items'][number]['status'];

      if (!phone) {
        status = Status.INVALID_PHONE;
      } else if (seenPhones.has(phone)) {
        status = Status.DUPLICATE_IN_BATCH;
      } else {
        seenPhones.add(phone);
        if (!contact.consent?.granted) {
          status = Status.CONSENT_REQUIRED;
        } else if (!contact.consent.source || !contact.consent.capturedAt) {
          status = Status.CONSENT_EVIDENCE_INCOMPLETE;
        } else {
          const capturedAt = Date.parse(contact.consent.capturedAt);
          if (!Number.isFinite(capturedAt) || capturedAt > now) {
            status = Status.CONSENT_TIMESTAMP_INVALID;
          } else {
            status = Status.VALIDATED_FOR_REVIEW;
          }
        }
      }

      switch (status) {
        case Status.VALIDATED_FOR_REVIEW:
          summary.validatedForReview += 1;
          break;
        case Status.INVALID_PHONE:
          summary.invalidPhone += 1;
          break;
        case Status.CONSENT_REQUIRED:
          summary.consentRequired += 1;
          break;
        case Status.CONSENT_EVIDENCE_INCOMPLETE:
          summary.consentEvidenceIncomplete += 1;
          break;
        case Status.CONSENT_TIMESTAMP_INVALID:
          summary.consentTimestampInvalid += 1;
          break;
        case Status.DUPLICATE_IN_BATCH:
          summary.duplicateInBatch += 1;
          break;
      }

      return { index, status };
    });

    return {
      previewOnly: true,
      invitationEligibility: 'NOT_EVALUATED',
      dispatchEnabled: false,
      dispatchBlockedReason: 'CONSENT_SUPPRESSION_AND_PROVIDER_GATES_REQUIRED',
      summary,
      items,
    };
  }
}
