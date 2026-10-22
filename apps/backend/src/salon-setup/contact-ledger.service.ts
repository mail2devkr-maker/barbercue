import { HttpStatus, Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import {
  CONTACT_LEDGER_DEFAULT_RETENTION_DAYS,
  CONTACT_LEDGER_MAX_RETENTION_DAYS,
  CONTACT_LEDGER_MIN_RETENTION_DAYS,
  CONTACT_LEDGER_POLICY_VERSION,
  CONTACT_LEDGER_PURPOSE,
  ContactLedgerErrorCode,
  ContactLedgerOutcome as Outcome,
  normalizeContactPhone,
  type ContactLedgerSummaryDto,
  type EraseContactInput,
  type EraseContactResultDto,
  type PurgeExpiredContactConsentsResultDto,
  type RecordContactConsentsInput,
  type RecordContactConsentsResultDto,
  type WithdrawContactConsentInput,
  type WithdrawContactConsentResultDto,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { isContactLedgerConfigured } from './contact-ledger.config';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Durable consent ledger for owner-supplied contact lists (requirement 13), without any delivery.
 *
 *  - Off unless CONTACT_LEDGER_ENABLED=true AND CONTACT_LEDGER_HASH_KEY (>= 32 chars) is set: fail closed (503).
 *  - A phone number is never stored or returned: records are matched by HMAC-SHA256(E.164, key). The key must stay
 *    stable (a rotation would orphan every record and, worse, the do-not-contact list) and is never logged.
 *  - Consent is per shop; a platform-wide suppression overrides everything and survives erasure.
 *  - Owner attestation is evidence, not proof, and never authorises a send: dispatch is not part of this service.
 *  - Audit rows carry counts and record ids only.
 */
@Injectable()
export class ContactLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  isConfigured(): boolean {
    return isContactLedgerConfigured();
  }

  retentionDays(): number {
    const raw = Number(process.env.CONTACT_CONSENT_RETENTION_DAYS);
    if (!Number.isInteger(raw)) return CONTACT_LEDGER_DEFAULT_RETENTION_DAYS;
    return Math.min(
      CONTACT_LEDGER_MAX_RETENTION_DAYS,
      Math.max(CONTACT_LEDGER_MIN_RETENTION_DAYS, raw),
    );
  }

  private gate() {
    return {
      dispatchEnabled: false as const,
      dispatchBlockedReason: 'PROVIDER_AND_APPROVAL_GATES_REQUIRED' as const,
      policyVersion: CONTACT_LEDGER_POLICY_VERSION,
      retentionDays: this.retentionDays(),
    };
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new AppException(
        ContactLedgerErrorCode.NOT_CONFIGURED,
        'The consent ledger is not enabled for this environment.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private hash(e164: string): string {
    return createHmac('sha256', process.env.CONTACT_LEDGER_HASH_KEY as string)
      .update(e164)
      .digest('hex');
  }

  private hashOrThrow(phone: string): string {
    const e164 = normalizeContactPhone(phone);
    if (!e164) {
      throw new AppException(
        ContactLedgerErrorCode.INVALID_PHONE,
        'That is not a valid mobile number.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.hash(e164);
  }

  async record(
    userId: string,
    salonId: string,
    input: RecordContactConsentsInput,
  ): Promise<RecordContactConsentsResultDto> {
    this.assertConfigured();
    await this.salonAccess.assertOwnerAccess(userId, salonId);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.retentionDays() * DAY_MS);
    const seen = new Set<string>();
    const outcomes: Outcome[] = new Array<Outcome>(input.contacts.length);
    const candidates: Array<{
      index: number;
      hash: string;
      source: string;
      capturedAt: Date;
    }> = [];

    input.contacts.forEach((contact, index) => {
      const e164 = normalizeContactPhone(contact.phone);
      if (!e164) {
        outcomes[index] = Outcome.INVALID_PHONE;
        return;
      }
      const hash = this.hash(e164);
      if (seen.has(hash)) {
        outcomes[index] = Outcome.DUPLICATE_IN_BATCH;
        return;
      }
      seen.add(hash);
      if (!contact.consent?.granted) {
        outcomes[index] = Outcome.CONSENT_REQUIRED;
        return;
      }
      if (!contact.consent.source || !contact.consent.capturedAt) {
        outcomes[index] = Outcome.CONSENT_EVIDENCE_INCOMPLETE;
        return;
      }
      const capturedAt = new Date(contact.consent.capturedAt);
      if (
        !Number.isFinite(capturedAt.getTime()) ||
        capturedAt.getTime() > now.getTime()
      ) {
        outcomes[index] = Outcome.CONSENT_TIMESTAMP_INVALID;
        return;
      }
      candidates.push({
        index,
        hash,
        source: contact.consent.source,
        capturedAt,
      });
    });

    if (candidates.length > 0) {
      const hashes = candidates.map((c) => c.hash);
      await this.prisma.$transaction(async (tx) => {
        const suppressed = new Set(
          (
            await tx.contactSuppression.findMany({
              where: { phoneHash: { in: hashes } },
              select: { phoneHash: true },
            })
          ).map((s) => s.phoneHash),
        );
        const existing = new Map(
          (
            await tx.contactConsentRecord.findMany({
              where: {
                salonId,
                purpose: CONTACT_LEDGER_PURPOSE,
                phoneHash: { in: hashes },
              },
            })
          ).map((r) => [r.phoneHash, r]),
        );

        for (const c of candidates) {
          if (suppressed.has(c.hash)) {
            outcomes[c.index] = Outcome.SUPPRESSED;
            continue;
          }
          const row = existing.get(c.hash);
          if (row) {
            const live = row.status === 'ACTIVE' && row.expiresAt > now;
            if (live) {
              outcomes[c.index] = Outcome.ALREADY_RECORDED;
              continue;
            }
            // Withdrawn: only a consent given AFTER the withdrawal may be recorded again.
            if (
              row.status === 'WITHDRAWN' &&
              row.withdrawnAt &&
              c.capturedAt.getTime() <= row.withdrawnAt.getTime()
            ) {
              outcomes[c.index] = Outcome.WITHDRAWN_BY_CONTACT;
              continue;
            }
            await tx.contactConsentRecord.update({
              where: { id: row.id },
              data: {
                status: 'ACTIVE',
                withdrawnAt: null,
                source: c.source,
                capturedAt: c.capturedAt,
                recordedAt: now,
                recordedByUserId: userId,
                policyVersion: CONTACT_LEDGER_POLICY_VERSION,
                expiresAt,
              },
            });
            outcomes[c.index] = Outcome.RECORDED;
            continue;
          }
          // ON CONFLICT DO NOTHING: a concurrent request that recorded the same contact first wins, harmlessly.
          const created = await tx.contactConsentRecord.createMany({
            data: [
              {
                salonId,
                phoneHash: c.hash,
                purpose: CONTACT_LEDGER_PURPOSE,
                source: c.source,
                capturedAt: c.capturedAt,
                recordedAt: now,
                recordedByUserId: userId,
                policyVersion: CONTACT_LEDGER_POLICY_VERSION,
                expiresAt,
              },
            ],
            skipDuplicates: true,
          });
          outcomes[c.index] =
            created.count === 1 ? Outcome.RECORDED : Outcome.ALREADY_RECORDED;
        }

        const recorded = outcomes.filter((o) => o === Outcome.RECORDED).length;
        if (recorded > 0) {
          await tx.auditLog.create({
            data: {
              actorUserId: userId,
              action: 'CONTACT_CONSENT_RECORDED',
              entityType: 'Salon',
              entityId: salonId,
              metadata: {
                recorded,
                submitted: input.contacts.length,
                policyVersion: CONTACT_LEDGER_POLICY_VERSION,
              },
            },
          });
        }
      });
    }

    const count = (o: Outcome) => outcomes.filter((x) => x === o).length;
    const accepted = new Set<Outcome>([
      Outcome.RECORDED,
      Outcome.ALREADY_RECORDED,
      Outcome.SUPPRESSED,
      Outcome.WITHDRAWN_BY_CONTACT,
    ]);
    return {
      ...this.gate(),
      summary: {
        total: input.contacts.length,
        recorded: count(Outcome.RECORDED),
        alreadyRecorded: count(Outcome.ALREADY_RECORDED),
        suppressed: count(Outcome.SUPPRESSED),
        withdrawnByContact: count(Outcome.WITHDRAWN_BY_CONTACT),
        rejected: outcomes.filter((o) => !accepted.has(o)).length,
      },
      items: outcomes.map((outcome, index) => ({ index, outcome })),
    };
  }

  async summary(
    userId: string,
    salonId: string,
  ): Promise<ContactLedgerSummaryDto> {
    this.assertConfigured();
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * DAY_MS);
    const base = { salonId, purpose: CONTACT_LEDGER_PURPOSE };
    const [active, withdrawn, expired, expiringWithin30Days] =
      await Promise.all([
        this.prisma.contactConsentRecord.count({
          where: { ...base, status: 'ACTIVE', expiresAt: { gt: now } },
        }),
        this.prisma.contactConsentRecord.count({
          where: { ...base, status: 'WITHDRAWN' },
        }),
        this.prisma.contactConsentRecord.count({
          where: { ...base, status: 'ACTIVE', expiresAt: { lte: now } },
        }),
        this.prisma.contactConsentRecord.count({
          where: {
            ...base,
            status: 'ACTIVE',
            expiresAt: { gt: now, lte: soon },
          },
        }),
      ]);
    return {
      ...this.gate(),
      active,
      withdrawn,
      expired,
      expiringWithin30Days,
    };
  }

  async withdraw(
    userId: string,
    salonId: string,
    input: WithdrawContactConsentInput,
  ): Promise<WithdrawContactConsentResultDto> {
    this.assertConfigured();
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    const hash = this.hashOrThrow(input.phone);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.contactConsentRecord.findUnique({
        where: {
          salonId_phoneHash_purpose: {
            salonId,
            phoneHash: hash,
            purpose: CONTACT_LEDGER_PURPOSE,
          },
        },
      });
      let withdrawn = false;
      if (row && row.status === 'ACTIVE') {
        await tx.contactConsentRecord.update({
          where: { id: row.id },
          data: { status: 'WITHDRAWN', withdrawnAt: now },
        });
        withdrawn = true;
      }
      if (input.suppressEverywhere) {
        await tx.contactSuppression.upsert({
          where: { phoneHash: hash },
          create: {
            phoneHash: hash,
            reason: 'OPT_OUT',
            createdByUserId: userId,
          },
          update: {},
        });
      }
      if (withdrawn || input.suppressEverywhere) {
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'CONTACT_CONSENT_WITHDRAWN',
            entityType: 'ContactConsentRecord',
            entityId: row?.id ?? salonId,
            metadata: {
              salonId,
              withdrawn,
              suppressedEverywhere: input.suppressEverywhere,
            },
          },
        });
      }
      return { withdrawn, suppressedEverywhere: input.suppressEverywhere };
    });
  }

  async erase(
    userId: string,
    salonId: string,
    input: EraseContactInput,
  ): Promise<EraseContactResultDto> {
    this.assertConfigured();
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    const hash = this.hashOrThrow(input.phone);

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.contactConsentRecord.findMany({
        where: { salonId, phoneHash: hash },
        select: { id: true },
      });
      await tx.contactConsentRecord.deleteMany({
        where: { salonId, phoneHash: hash },
      });
      if (input.keepSuppression) {
        await tx.contactSuppression.upsert({
          where: { phoneHash: hash },
          create: {
            phoneHash: hash,
            reason: 'ERASURE_REQUEST',
            createdByUserId: userId,
          },
          update: {},
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'CONTACT_CONSENT_ERASED',
          entityType: 'Salon',
          entityId: salonId,
          // Record ids only: the deleted rows were the sole link between a number and this shop.
          metadata: {
            erasedRecordIds: rows.map((r) => r.id),
            suppressionKept: input.keepSuppression,
          },
        },
      });
      return { erased: rows.length, suppressionKept: input.keepSuppression };
    });
  }

  /** Platform housekeeping: delete every record past its retention. Explicitly triggered, never scheduled. */
  async purgeExpired(
    adminUserId: string,
  ): Promise<PurgeExpiredContactConsentsResultDto> {
    this.assertConfigured();
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.contactConsentRecord.findMany({
        where: { expiresAt: { lte: now } },
        select: { id: true },
      });
      const result = await tx.contactConsentRecord.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
      if (result.count > 0) {
        await tx.auditLog.create({
          data: {
            actorUserId: adminUserId,
            action: 'CONTACT_CONSENT_PURGED_EXPIRED',
            entityType: 'ContactConsentRecord',
            entityId: 'batch',
            metadata: { purged: result.count },
          },
        });
      }
      return { purged: result.count };
    });
  }
}
