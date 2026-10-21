import { HttpStatus, Injectable } from '@nestjs/common';
import {
  EmployeeEmploymentStatus,
  EmployeeIdentityContactKind,
  EmployeeIdentityHistoryStatus,
  EmployeeIdentityVerificationStatus,
  EmployeeOfferDocumentStatus,
  EmployeeOfferStatus,
  Role,
  UserStatus,
  type CreateEmployeeIdentityInput,
  type CreateEmployeeOfferInput,
  type EmployeeEmploymentEpisodeDto,
  type EmployeeHrTimelineDto,
  type EmployeeIdentityMatchDto,
  type EmployeeIdentityMatchReviewDto,
  type EmployeeOfferVersionDto,
  type ExitEmployeeInput,
  type IssueEmployeeOfferInput,
  type JoinEmployeeInput,
  type ReconcileHistoricalEmployeeOfferInput,
  type ReconcileLegacyEmploymentInput,
  type ReviewEmployeeIdentityHistoryInput,
  type SearchEmployeeIdentityInput,
  type MatchEmployeeIdentityInput,
  type UpdateEmployeeOfferDocumentInput,
  type UpdateEmployeeOfferStatusInput,
  type VerifyEmployeeIdentityInput,
} from '@barbercue/shared';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { CryptoService } from '../auth/services/crypto.service';
import { PasswordService } from '../auth/services/password.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  allocateNextEmployeeCode,
  lockEmployeeCodeNamespace,
} from './employee-code-allocator';

type Tx = Prisma.TransactionClient;
type IdentityWithHistory = Prisma.EmployeeIdentityGetPayload<{
  include: {
    contacts: true;
    offers: { orderBy: { version: 'asc' } };
    episodes: { orderBy: { episodeNumber: 'asc' } };
    events: { orderBy: { occurredAt: 'asc' } };
    employeeProfile: { include: { user: { select: { status: true } } } };
  };
}>;

@Injectable()
export class AdminEmployeeRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
  ) {}

  async search(
    input: SearchEmployeeIdentityInput,
  ): Promise<EmployeeIdentityMatchDto[]> {
    this.assertFeatureEnabled();
    const query = input.q.trim();
    if (
      query.includes('@') ||
      (query.replace(/\D/g, '').length >= 7 && !/^FQ-FE-\d+$/i.test(query))
    ) {
      throw new AppException(
        'HR_CONTACT_SEARCH_REQUIRES_POST',
        'Search phone or email through the protected match-review endpoint, not a URL query.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const or: Prisma.EmployeeIdentityWhereInput[] = [
      { fullName: { contains: query, mode: 'insensitive' } },
      { employeeCode: { contains: query, mode: 'insensitive' } },
    ];

    const rows = await this.prisma.employeeIdentity.findMany({
      where: { OR: or },
      orderBy: [{ employeeCode: 'asc' }, { fullName: 'asc' }, { id: 'asc' }],
      take: input.limit,
      include: {
        contacts: { orderBy: { createdAt: 'desc' } },
        employeeProfile: { include: { user: { select: { status: true } } } },
        episodes: { orderBy: { episodeNumber: 'desc' }, take: 1 },
        events: {
          where: { entityType: 'EMPLOYMENT_EPISODE' },
          orderBy: { occurredAt: 'desc' },
          take: 2,
        },
      },
    });
    return rows.map((row) => this.personDto(row));
  }

  async matchCandidates(
    input: MatchEmployeeIdentityInput,
  ): Promise<EmployeeIdentityMatchReviewDto> {
    this.assertFeatureEnabled();
    const email = input.email ? normalizeEmail(input.email) : undefined;
    const phone = input.phone ? normalizePhone(input.phone) : undefined;
    const employeeCode = input.employeeCode?.trim().toUpperCase();
    const hashes = [
      ...(email
        ? [
            {
              kind: EmployeeIdentityContactKind.EMAIL,
              lookupHash: this.crypto.blindIndex('hr-email', email),
            },
          ]
        : []),
      ...(phone
        ? [
            {
              kind: EmployeeIdentityContactKind.PHONE,
              lookupHash: this.crypto.blindIndex('hr-phone', phone),
            },
          ]
        : []),
    ];
    const or: Prisma.EmployeeIdentityWhereInput[] = [];
    if (input.fullName) {
      or.push({
        fullName: { equals: input.fullName.trim(), mode: 'insensitive' },
      });
    }
    if (employeeCode) or.push({ employeeCode });
    if (hashes.length) or.push({ contacts: { some: { OR: hashes } } });
    const rows = await this.prisma.employeeIdentity.findMany({
      where: { OR: or },
      orderBy: [{ employeeCode: 'asc' }, { fullName: 'asc' }, { id: 'asc' }],
      take: input.limit,
      include: {
        contacts: { orderBy: { createdAt: 'desc' } },
        employeeProfile: { include: { user: { select: { status: true } } } },
        episodes: { orderBy: { episodeNumber: 'desc' }, take: 1 },
        events: {
          where: { entityType: 'EMPLOYMENT_EPISODE' },
          orderBy: { occurredAt: 'desc' },
          take: 2,
        },
      },
    });
    const verifiedEmployeeAccounts = hashes.length
      ? await this.prisma.user.findMany({
          where: {
            OR: hashes.map((hash) =>
              hash.kind === EmployeeIdentityContactKind.EMAIL
                ? { email: email, emailVerifiedAt: { not: null } }
                : { phone: phone, phoneVerifiedAt: { not: null } },
            ),
            employeeProfile: { isNot: null },
          },
          select: {
            employeeProfile: { select: { employeeIdentityId: true } },
          },
        })
      : [];
    const linkedIdentityIds = [
      ...new Set(
        verifiedEmployeeAccounts
          .map((account) => account.employeeProfile?.employeeIdentityId)
          .filter((id): id is string => id !== null && id !== undefined),
      ),
    ];
    const legacyProfileNeedsReconciliation = verifiedEmployeeAccounts.some(
      (account) => account.employeeProfile?.employeeIdentityId === null,
    );
    const linkedIdentities = linkedIdentityIds.length
      ? await this.prisma.employeeIdentity.findMany({
          where: { id: { in: linkedIdentityIds } },
          include: {
            contacts: { orderBy: { createdAt: 'desc' } },
            employeeProfile: {
              include: { user: { select: { status: true } } },
            },
            episodes: { orderBy: { episodeNumber: 'desc' }, take: 1 },
            events: {
              where: { entityType: 'EMPLOYMENT_EPISODE' },
              orderBy: { occurredAt: 'desc' },
              take: 2,
            },
          },
        })
      : [];
    const identities = [
      ...new Map(
        [...rows, ...linkedIdentities].map((row) => [row.id, row]),
      ).values(),
    ];
    const normalizedName = input.fullName?.trim().toLocaleLowerCase('en-US');
    const matches = identities.map((row) => {
      const reasons: EmployeeIdentityMatchReviewDto['matches'][number]['reasons'] =
        [];
      if (employeeCode && row.employeeCode === employeeCode)
        reasons.push('EMPLOYEE_CODE');
      if (
        hashes.some((hash) =>
          row.contacts.some(
            (contact) =>
              contact.kind === hash.kind &&
              contact.lookupHash === hash.lookupHash,
          ),
        ) ||
        linkedIdentityIds.includes(row.id)
      )
        reasons.push('EXACT_CONTACT');
      if (
        normalizedName &&
        row.fullName.trim().toLocaleLowerCase('en-US') === normalizedName
      )
        reasons.push('NAME');
      return {
        person: this.personDto(row),
        reasons,
        strength: reasons.some((reason) => reason !== 'NAME')
          ? ('STRONG' as const)
          : ('POSSIBLE' as const),
      };
    });
    return {
      matches,
      blocksNewIdentity:
        matches.some((match) =>
          match.reasons.some((reason) => reason !== 'NAME'),
        ) || legacyProfileNeedsReconciliation,
      requiresReview: matches.length > 0 || legacyProfileNeedsReconciliation,
      requiresLegacyProfileReconciliation: legacyProfileNeedsReconciliation,
    };
  }

  async createIdentity(
    actorUserId: string,
    input: CreateEmployeeIdentityInput,
  ): Promise<EmployeeHrTimelineDto> {
    this.assertFeatureEnabled();
    const email = input.email ? normalizeEmail(input.email) : undefined;
    const phone = input.phone ? normalizePhone(input.phone) : undefined;
    const request = { ...input, email, phone };
    const fingerprint = this.fingerprint({
      action: 'create-identity',
      request,
    });
    const identityId = await this.retrySerializableConflicts(() =>
      this.prisma.$transaction(
        async (tx) => {
          const replay = await this.findReplay(
            tx,
            actorUserId,
            input.idempotencyKey,
            fingerprint,
          );
          if (replay) return this.replayIdentityId(replay);

          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fastque_hr_person_registry'))`;
          const hashes = [
            ...(email
              ? [
                  {
                    kind: EmployeeIdentityContactKind.EMAIL,
                    lookupHash: this.crypto.blindIndex('hr-email', email),
                  },
                ]
              : []),
            ...(phone
              ? [
                  {
                    kind: EmployeeIdentityContactKind.PHONE,
                    lookupHash: this.crypto.blindIndex('hr-phone', phone),
                  },
                ]
              : []),
          ];
          const contactMatches = hashes.length
            ? await tx.employeeIdentity.findMany({
                where: { contacts: { some: { OR: hashes } } },
                select: { id: true },
              })
            : [];
          const sameNameMatches = await tx.employeeIdentity.findMany({
            where: {
              fullName: { equals: input.fullName.trim(), mode: 'insensitive' },
            },
            select: { id: true },
          });
          const verifiedEmployeeAccounts = hashes.length
            ? await tx.user.findMany({
                where: {
                  OR: hashes.map((hash) =>
                    hash.kind === EmployeeIdentityContactKind.EMAIL
                      ? { email, emailVerifiedAt: { not: null } }
                      : { phone, phoneVerifiedAt: { not: null } },
                  ),
                  employeeProfile: { isNot: null },
                },
                select: {
                  employeeProfile: {
                    select: { employeeIdentityId: true },
                  },
                },
              })
            : [];
          if (
            verifiedEmployeeAccounts.some(
              (account) => account.employeeProfile?.employeeIdentityId === null,
            )
          ) {
            throw this.conflict(
              'EMPLOYEE_LEGACY_PROFILE_RECONCILIATION_REQUIRED',
              'A verified contact belongs to a legacy employee profile without a permanent identity link. Reconcile that record before creating another identity.',
            );
          }
          const reviewedIds = [
            ...new Set(input.matchReview.reviewedPersonIds),
          ].sort();
          const currentMatchIds = [
            ...new Set([
              ...sameNameMatches.map((row) => row.id),
              ...contactMatches.map((row) => row.id),
              ...verifiedEmployeeAccounts
                .map((account) => account.employeeProfile?.employeeIdentityId)
                .filter((id): id is string => id !== null && id !== undefined),
            ]),
          ].sort();
          if (
            (currentMatchIds.length === 0 &&
              (input.matchReview.decision !== 'NO_MATCH' ||
                reviewedIds.length > 0)) ||
            (currentMatchIds.length > 0 &&
              (input.matchReview.decision !== 'DISTINCT_PERSON' ||
                JSON.stringify(reviewedIds) !==
                  JSON.stringify(currentMatchIds)))
          ) {
            throw this.conflict(
              'EMPLOYEE_IDENTITY_MATCH_REQUIRES_REVIEW',
              'Review every exact-contact, linked-account and same-name employee match; record an exact audited distinct-person decision before creating another identity.',
            );
          }

          const identity = await tx.employeeIdentity.create({
            data: {
              fullName: input.fullName.trim(),
              verificationStatus:
                EmployeeIdentityVerificationStatus.NEEDS_REVIEW,
              historyStatus: EmployeeIdentityHistoryStatus.COMPLETE,
              contacts: {
                create: [
                  ...(email
                    ? [
                        {
                          kind: EmployeeIdentityContactKind.EMAIL,
                          encryptedValue: this.crypto.encrypt(email),
                          lookupHash: this.crypto.blindIndex('hr-email', email),
                        },
                      ]
                    : []),
                  ...(phone
                    ? [
                        {
                          kind: EmployeeIdentityContactKind.PHONE,
                          encryptedValue: this.crypto.encrypt(phone),
                          lookupHash: this.crypto.blindIndex('hr-phone', phone),
                        },
                      ]
                    : []),
                ],
              },
            },
          });
          await this.writeEvent(tx, {
            identityId: identity.id,
            actorUserId,
            eventType: 'EMPLOYEE_IDENTITY_MATCH_REVIEWED',
            entityType: 'EMPLOYEE_IDENTITY',
            entityId: identity.id,
            reason: `${input.matchReview.reason} Evidence reference: ${input.matchReview.evidenceReference}`,
            metadata: {
              decision: input.matchReview.decision,
              reviewedPersonIds: reviewedIds,
              evidenceReferenceRecorded: true,
            },
          });
          await this.writeEvent(tx, {
            identityId: identity.id,
            actorUserId,
            eventType: 'EMPLOYEE_IDENTITY_CREATED',
            entityType: 'EMPLOYEE_IDENTITY',
            entityId: identity.id,
            metadata: {
              verificationStatus: 'NEEDS_REVIEW',
              employeeCodeAllocated: false,
            },
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fingerprint,
          });
          return identity.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
    return this.getPerson(identityId);
  }

  async getPerson(identityId: string): Promise<EmployeeHrTimelineDto> {
    this.assertFeatureEnabled();
    const row = await this.prisma.employeeIdentity.findUnique({
      where: { id: identityId },
      include: {
        contacts: { orderBy: { createdAt: 'desc' } },
        offers: { orderBy: { version: 'asc' } },
        episodes: { orderBy: { episodeNumber: 'asc' } },
        events: { orderBy: { occurredAt: 'asc' } },
        employeeProfile: { include: { user: { select: { status: true } } } },
      },
    });
    if (!row)
      this.notFound(
        'EMPLOYEE_IDENTITY_NOT_FOUND',
        'Employee identity not found.',
      );
    return this.timelineDto(row);
  }

  async verifyIdentity(
    actorUserId: string,
    identityId: string,
    input: VerifyEmployeeIdentityInput,
  ): Promise<EmployeeHrTimelineDto> {
    this.assertFeatureEnabled();
    const fingerprint = this.fingerprint({
      action: 'verify-identity',
      identityId,
      input,
    });
    await this.prisma.$transaction(
      async (tx) => {
        const replay = await this.findReplay(
          tx,
          actorUserId,
          input.idempotencyKey,
          fingerprint,
        );
        if (replay) return;
        await this.lockIdentity(tx, identityId);
        const identity = await tx.employeeIdentity.findUnique({
          where: { id: identityId },
        });
        if (!identity)
          this.notFound(
            'EMPLOYEE_IDENTITY_NOT_FOUND',
            'Employee identity not found.',
          );
        await tx.employeeIdentity.update({
          where: { id: identityId },
          data: {
            verificationStatus: EmployeeIdentityVerificationStatus.VERIFIED,
            verificationMethod: input.verificationMethod,
            verificationEvidenceRef: input.evidenceReference,
            verifiedAt: new Date(),
            verifiedByUserId: actorUserId,
          },
        });
        await this.writeEvent(tx, {
          identityId,
          actorUserId,
          eventType: 'EMPLOYEE_IDENTITY_VERIFIED',
          entityType: 'EMPLOYEE_IDENTITY',
          entityId: identityId,
          reason: input.reason,
          metadata: {
            verificationMethod: input.verificationMethod,
            evidenceReferenceRecorded: true,
          },
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getPerson(identityId);
  }

  async reviewHistory(
    actorUserId: string,
    identityId: string,
    input: ReviewEmployeeIdentityHistoryInput,
  ): Promise<EmployeeHrTimelineDto> {
    this.assertFeatureEnabled();
    const fingerprint = this.fingerprint({
      action: 'review-identity-history',
      identityId,
      input,
    });
    await this.prisma.$transaction(
      async (tx) => {
        if (
          await this.findReplay(
            tx,
            actorUserId,
            input.idempotencyKey,
            fingerprint,
          )
        )
          return;
        await this.lockIdentity(tx, identityId);
        const identity = await tx.employeeIdentity.findUnique({
          where: { id: identityId },
        });
        if (!identity)
          this.notFound(
            'EMPLOYEE_IDENTITY_NOT_FOUND',
            'Employee identity not found.',
          );
        await tx.employeeIdentity.update({
          where: { id: identityId },
          data: { historyStatus: input.status },
        });
        await this.writeEvent(tx, {
          identityId,
          actorUserId,
          eventType: 'EMPLOYMENT_HISTORY_REVIEWED',
          entityType: 'EMPLOYEE_IDENTITY',
          entityId: identityId,
          reason: `${input.reason} Evidence reference: ${input.evidenceReference}`,
          metadata: {
            historyStatus: input.status,
            evidenceReferenceRecorded: true,
          },
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getPerson(identityId);
  }

  async createOffer(
    actorUserId: string,
    identityId: string,
    input: CreateEmployeeOfferInput,
  ): Promise<EmployeeOfferVersionDto> {
    this.assertFeatureEnabled();
    const fingerprint = this.fingerprint({
      action: 'create-offer',
      identityId,
      input,
    });
    const offerId = await this.prisma.$transaction(
      async (tx) => {
        if (
          await this.findReplay(
            tx,
            actorUserId,
            input.idempotencyKey,
            fingerprint,
          )
        ) {
          const prior = await tx.employeeHrEvent.findFirst({
            where: { actorUserId, idempotencyKey: input.idempotencyKey },
          });
          return prior!.entityId;
        }
        await this.lockIdentity(tx, identityId);
        const identity = await tx.employeeIdentity.findUnique({
          where: { id: identityId },
        });
        if (!identity)
          this.notFound(
            'EMPLOYEE_IDENTITY_NOT_FOUND',
            'Employee identity not found.',
          );
        if (
          identity.verificationStatus !==
            EmployeeIdentityVerificationStatus.VERIFIED ||
          identity.historyStatus !== EmployeeIdentityHistoryStatus.COMPLETE
        ) {
          throw this.conflict(
            'EMPLOYEE_IDENTITY_REVIEW_REQUIRED',
            'Verify the person and resolve employment history before creating an official offer.',
          );
        }
        const activeProfile = await tx.employeeProfile.findUnique({
          where: { employeeIdentityId: identityId },
          include: { user: { select: { status: true } } },
        });
        if (activeProfile?.user.status === UserStatus.ACTIVE)
          throw this.conflict(
            'EMPLOYEE_ALREADY_ACTIVE',
            'An active employee cannot receive a new hire offer.',
          );
        const previousOffer = await tx.employeeOfferVersion.findFirst({
          where: { identityId },
          orderBy: { version: 'desc' },
          select: { id: true, source: true },
        });
        if (previousOffer) {
          const previousStatus = await this.latestOfferStatus(
            tx,
            previousOffer.id,
            previousOffer.source === 'HR_CREATED'
              ? EmployeeOfferStatus.DRAFT
              : EmployeeOfferStatus.UNKNOWN,
          );
          const concludedWithoutJoin =
            previousStatus === EmployeeOfferStatus.DECLINED ||
            previousStatus === EmployeeOfferStatus.EXPIRED ||
            previousStatus === EmployeeOfferStatus.NOT_JOINED;
          const rehireAfterExit =
            previousStatus === EmployeeOfferStatus.JOINED &&
            activeProfile?.user.status === UserStatus.SUSPENDED &&
            (await this.currentEpisodeId(tx, identityId)) === null;
          if (!concludedWithoutJoin && !rehireAfterExit) {
            throw this.conflict(
              'EMPLOYEE_OPEN_OFFER_EXISTS',
              'The latest offer must be concluded as declined, expired, or not joined, or a joined employee must have a recorded exit, before issuing another version.',
            );
          }
        }
        const aggregate = await tx.employeeOfferVersion.aggregate({
          where: { identityId },
          _max: { version: true },
        });
        const version = (aggregate._max.version ?? 0) + 1;
        const compensation = {
          baseAmount: input.compensation.baseAmount,
          currency: input.compensation.currency,
          frequency: input.compensation.frequency,
          incentiveAmount: input.compensation.incentiveAmount ?? null,
          additionalTerms: input.compensation.additionalTerms ?? null,
        };
        const offer = await tx.employeeOfferVersion.create({
          data: {
            identityId,
            version,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fingerprint,
            candidateNameSnapshot:
              input.candidateName?.trim() || identity.fullName,
            position: input.position.trim(),
            reportingManager: input.reportingManager?.trim() || null,
            proposedJoiningAt: input.proposedJoiningAt
              ? new Date(input.proposedJoiningAt)
              : null,
            compensationTermsCiphertext: this.crypto.encrypt(
              JSON.stringify(compensation),
            ),
          },
        });
        await this.writeEvent(tx, {
          identityId,
          actorUserId,
          eventType: 'EMPLOYEE_OFFER_DRAFTED',
          entityType: 'EMPLOYEE_OFFER',
          entityId: offer.id,
          metadata: { version, status: EmployeeOfferStatus.DRAFT },
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
        });
        return offer.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getOffer(offerId);
  }

  async reconcileHistoricalOffer(
    actorUserId: string,
    identityId: string,
    input: ReconcileHistoricalEmployeeOfferInput,
  ): Promise<EmployeeOfferVersionDto> {
    this.assertFeatureEnabled();
    const fingerprint = this.fingerprint({
      action: 'reconcile-historical-offer',
      identityId,
      input,
    });
    const offerId = await this.prisma.$transaction(
      async (tx) => {
        const replay = await this.findReplay(
          tx,
          actorUserId,
          input.idempotencyKey,
          fingerprint,
        );
        if (replay) return replay.entityId;
        await this.lockIdentity(tx, identityId);
        await lockEmployeeCodeNamespace(tx);
        const identity = await tx.employeeIdentity.findUnique({
          where: { id: identityId },
        });
        if (!identity)
          this.notFound(
            'EMPLOYEE_IDENTITY_NOT_FOUND',
            'Employee identity not found.',
          );
        if (
          identity.verificationStatus !==
            EmployeeIdentityVerificationStatus.VERIFIED ||
          identity.historyStatus !== EmployeeIdentityHistoryStatus.COMPLETE
        ) {
          throw this.conflict(
            'EMPLOYEE_IDENTITY_REVIEW_REQUIRED',
            'Verify the person and resolve employment history before reconciling an offer.',
          );
        }
        if (
          input.historicalStatus === EmployeeOfferStatus.UNKNOWN ||
          input.historicalStatus === EmployeeOfferStatus.DRAFT
        ) {
          throw new AppException(
            'EMPLOYEE_HISTORICAL_OFFER_STATUS_INVALID',
            'A historical offer must have evidence of an officially issued offer.',
            HttpStatus.BAD_REQUEST,
          );
        }
        if (input.historicalStatus === EmployeeOfferStatus.JOINED) {
          throw new AppException(
            'EMPLOYMENT_HISTORY_RECONCILIATION_REQUIRED',
            'Record historical employment through the employment-history reconciliation action; an offer status alone cannot prove that the candidate joined.',
            HttpStatus.BAD_REQUEST,
          );
        }
        const employeeCode =
          identity.employeeCode ?? (await allocateNextEmployeeCode(tx));
        if (!identity.employeeCode)
          await tx.employeeIdentity.update({
            where: { id: identityId },
            data: { employeeCode },
          });
        const aggregate = await tx.employeeOfferVersion.aggregate({
          where: { identityId },
          _max: { version: true },
        });
        const version = (aggregate._max.version ?? 0) + 1;
        const compensation = {
          baseAmount: input.compensation.baseAmount,
          currency: input.compensation.currency,
          frequency: input.compensation.frequency,
          incentiveAmount: input.compensation.incentiveAmount ?? null,
          additionalTerms: input.compensation.additionalTerms ?? null,
        };
        const offer = await tx.employeeOfferVersion.create({
          data: {
            identityId,
            version,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fingerprint,
            source: 'HISTORICAL_RECONCILIATION',
            candidateNameSnapshot:
              input.candidateName?.trim() || identity.fullName,
            position: input.position.trim(),
            reportingManager: input.reportingManager?.trim() || null,
            proposedJoiningAt: input.proposedJoiningAt
              ? new Date(input.proposedJoiningAt)
              : null,
            compensationTermsCiphertext: this.crypto.encrypt(
              JSON.stringify(compensation),
            ),
            sourceReference: input.sourceReference,
            sourceOfferDate: new Date(input.offerDate),
          },
        });
        await this.writeEvent(tx, {
          identityId,
          actorUserId,
          eventType: 'EMPLOYEE_OFFER_HISTORICAL_RECONCILED',
          entityType: 'EMPLOYEE_OFFER',
          entityId: offer.id,
          reason: `Evidence reference: ${input.sourceReference}`,
          metadata: {
            version,
            employeeCode,
            status: input.historicalStatus,
            sourceOfferDateRecorded: true,
          },
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
        });
        return offer.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getOffer(offerId);
  }

  async issueOffer(
    actorUserId: string,
    offerId: string,
    input: IssueEmployeeOfferInput,
  ): Promise<EmployeeOfferVersionDto> {
    this.assertFeatureEnabled();
    const fingerprint = this.fingerprint({
      action: 'issue-offer',
      offerId,
      input,
    });
    const identityId = await this.prisma.$transaction(
      async (tx) => {
        const prior = await this.findReplay(
          tx,
          actorUserId,
          input.idempotencyKey,
          fingerprint,
        );
        if (prior) return prior.identityId;
        const offer = await tx.employeeOfferVersion.findUnique({
          where: { id: offerId },
        });
        if (!offer)
          this.notFound(
            'EMPLOYEE_OFFER_NOT_FOUND',
            'Employee offer not found.',
          );
        await this.lockIdentity(tx, offer.identityId);
        await lockEmployeeCodeNamespace(tx);
        const identity = await tx.employeeIdentity.findUnique({
          where: { id: offer.identityId },
        });
        if (!identity)
          this.notFound(
            'EMPLOYEE_IDENTITY_NOT_FOUND',
            'Employee identity not found.',
          );
        if (
          identity.verificationStatus !==
            EmployeeIdentityVerificationStatus.VERIFIED ||
          identity.historyStatus !== EmployeeIdentityHistoryStatus.COMPLETE
        ) {
          throw this.conflict(
            'EMPLOYEE_IDENTITY_REVIEW_REQUIRED',
            'Verify the person and resolve employment history before issuing an offer.',
          );
        }
        const currentStatus = await this.latestOfferStatus(
          tx,
          offer.id,
          offer.source === 'HR_CREATED'
            ? EmployeeOfferStatus.DRAFT
            : EmployeeOfferStatus.UNKNOWN,
        );
        if (
          offer.source !== 'HR_CREATED' ||
          currentStatus !== EmployeeOfferStatus.DRAFT
        ) {
          throw this.conflict(
            'EMPLOYEE_OFFER_NOT_DRAFT',
            'Only a draft offer may be issued.',
          );
        }
        if (!identity.employeeCode) {
          const employeeCode = await allocateNextEmployeeCode(tx);
          await tx.employeeIdentity.update({
            where: { id: identity.id },
            data: { employeeCode },
          });
        }
        await this.writeEvent(tx, {
          identityId: identity.id,
          actorUserId,
          eventType: 'EMPLOYEE_OFFER_ISSUED',
          entityType: 'EMPLOYEE_OFFER',
          entityId: offer.id,
          metadata: {
            status: EmployeeOfferStatus.ISSUED,
            employeeCodeAllocated: !identity.employeeCode,
          },
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
        });
        return identity.id;
        // The employee-code namespace advisory lock serializes allocations, while READ COMMITTED
        // gives the post-lock statements a fresh snapshot. SERIALIZABLE can abort a correctly
        // serialized second issuer as a false write conflict because its transaction snapshot is
        // taken before it waits on that lock.
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return this.getOfferByIdentity(offerId, identityId);
  }

  async updateOfferStatus(
    actorUserId: string,
    offerId: string,
    input: UpdateEmployeeOfferStatusInput,
  ): Promise<EmployeeOfferVersionDto> {
    this.assertFeatureEnabled();
    const fingerprint = this.fingerprint({
      action: 'update-offer-status',
      offerId,
      input,
    });
    await this.prisma.$transaction(
      async (tx) => {
        if (
          await this.findReplay(
            tx,
            actorUserId,
            input.idempotencyKey,
            fingerprint,
          )
        )
          return;
        const offer = await tx.employeeOfferVersion.findUnique({
          where: { id: offerId },
        });
        if (!offer)
          this.notFound(
            'EMPLOYEE_OFFER_NOT_FOUND',
            'Employee offer not found.',
          );
        await this.lockIdentity(tx, offer.identityId);
        const current = await this.latestOfferStatus(
          tx,
          offer.id,
          offer.source === 'HR_CREATED'
            ? EmployeeOfferStatus.DRAFT
            : EmployeeOfferStatus.UNKNOWN,
        );
        const allowed: Record<string, string[]> = {
          ISSUED: ['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'NOT_JOINED'],
          SENT: ['ACCEPTED', 'DECLINED', 'EXPIRED', 'NOT_JOINED'],
        };
        if (
          !allowed[current]?.includes(input.status) ||
          input.status === EmployeeOfferStatus.JOINED
        ) {
          throw this.conflict(
            'EMPLOYEE_OFFER_STATUS_TRANSITION_INVALID',
            'This offer status transition is not allowed. Use the joining action to record employment.',
          );
        }
        if (
          ['SENT', 'ACCEPTED', 'DECLINED', 'NOT_JOINED'].includes(
            input.status,
          ) &&
          !input.evidenceReference
        ) {
          throw new AppException(
            'EMPLOYEE_OFFER_EVIDENCE_REQUIRED',
            'Evidence is required for this offer status.',
            HttpStatus.BAD_REQUEST,
          );
        }
        await this.writeEvent(tx, {
          identityId: offer.identityId,
          actorUserId,
          eventType: 'EMPLOYEE_OFFER_STATUS_CHANGED',
          entityType: 'EMPLOYEE_OFFER',
          entityId: offer.id,
          reason:
            [
              input.reason,
              input.evidenceReference
                ? `Evidence reference: ${input.evidenceReference}`
                : undefined,
            ]
              .filter(Boolean)
              .join(' ') || undefined,
          metadata: { status: input.status },
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getOffer(offerId);
  }

  async updateOfferDocument(
    actorUserId: string,
    offerId: string,
    input: UpdateEmployeeOfferDocumentInput,
  ): Promise<EmployeeOfferVersionDto> {
    this.assertFeatureEnabled();
    const fingerprint = this.fingerprint({
      action: 'update-offer-document',
      offerId,
      input,
    });
    await this.prisma.$transaction(
      async (tx) => {
        if (
          await this.findReplay(
            tx,
            actorUserId,
            input.idempotencyKey,
            fingerprint,
          )
        )
          return;
        const offer = await tx.employeeOfferVersion.findUnique({
          where: { id: offerId },
        });
        if (!offer)
          this.notFound(
            'EMPLOYEE_OFFER_NOT_FOUND',
            'Employee offer not found.',
          );
        await this.lockIdentity(tx, offer.identityId);
        await this.writeEvent(tx, {
          identityId: offer.identityId,
          actorUserId,
          eventType: 'EMPLOYEE_OFFER_DOCUMENT_STATUS_CHANGED',
          entityType: 'EMPLOYEE_OFFER',
          entityId: offer.id,
          reason: input.evidenceReference
            ? `Evidence reference: ${input.evidenceReference}`
            : undefined,
          metadata: { documentStatus: input.status },
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getOffer(offerId);
  }

  async join(
    actorUserId: string,
    identityId: string,
    input: JoinEmployeeInput,
  ): Promise<EmployeeHrTimelineDto> {
    this.assertFeatureEnabled();
    const fingerprint = this.fingerprint({
      action: 'join-employee',
      identityId,
      input,
    });
    const passwordHash = input.password
      ? await this.passwords.hash(input.password)
      : null;
    await this.prisma.$transaction(
      async (tx) => {
        if (
          await this.findReplay(
            tx,
            actorUserId,
            input.idempotencyKey,
            fingerprint,
          )
        )
          return;
        await this.lockIdentity(tx, identityId);
        await lockEmployeeCodeNamespace(tx);
        const identity = await tx.employeeIdentity.findUnique({
          where: { id: identityId },
          include: {
            contacts: true,
            employeeProfile: { include: { user: true } },
          },
        });
        if (!identity)
          this.notFound(
            'EMPLOYEE_IDENTITY_NOT_FOUND',
            'Employee identity not found.',
          );
        if (
          identity.verificationStatus !==
            EmployeeIdentityVerificationStatus.VERIFIED ||
          identity.historyStatus !== EmployeeIdentityHistoryStatus.COMPLETE ||
          !identity.employeeCode
        ) {
          throw this.conflict(
            'EMPLOYEE_IDENTITY_REVIEW_REQUIRED',
            'A verified identity, complete history and issued offer are required before joining.',
          );
        }
        const offers = await tx.employeeOfferVersion.findMany({
          where: { identityId },
          orderBy: { version: 'desc' },
          take: 1,
        });
        if (
          !offers.length ||
          (await this.latestOfferStatus(
            tx,
            offers[0].id,
            offers[0].source === 'HR_CREATED'
              ? EmployeeOfferStatus.DRAFT
              : EmployeeOfferStatus.UNKNOWN,
          )) !== EmployeeOfferStatus.ACCEPTED
        ) {
          throw this.conflict(
            'EMPLOYEE_ACCEPTED_OFFER_REQUIRED',
            'The latest offer must be recorded as accepted before joining.',
          );
        }

        const profile = identity.employeeProfile;
        if (profile?.user.status === UserStatus.ACTIVE)
          throw this.conflict(
            'EMPLOYEE_ALREADY_ACTIVE',
            'This employee already has an active employment record.',
          );
        if (profile && profile.employeeIdentityId !== identityId)
          throw this.conflict(
            'EMPLOYEE_PROFILE_LINK_CONFLICT',
            'The existing employee profile is linked to a different person.',
          );
        let userId: string | null = profile?.userId ?? null;
        const userStatus: UserStatus | null = profile?.user.status ?? null;
        if (!userId) {
          const contactOr: Prisma.UserWhereInput[] = [];
          for (const contact of identity.contacts) {
            const value = this.crypto.decrypt(contact.encryptedValue);
            if (contact.kind === EmployeeIdentityContactKind.EMAIL)
              contactOr.push({ email: value, emailVerifiedAt: { not: null } });
            else
              contactOr.push({ phone: value, phoneVerifiedAt: { not: null } });
          }
          const matchedUsers = contactOr.length
            ? await tx.user.findMany({
                where: { OR: contactOr },
                include: { employeeProfile: true },
              })
            : [];
          const uniqueUsers = [
            ...new Map(matchedUsers.map((row) => [row.id, row])).values(),
          ];
          if (uniqueUsers.length > 1)
            throw this.conflict(
              'EMPLOYEE_ACCOUNT_MATCH_AMBIGUOUS',
              'Verified contact methods resolve to more than one account; HR must resolve this manually.',
            );
          const matchedUser = uniqueUsers[0] ?? null;
          if (
            matchedUser?.employeeProfile &&
            matchedUser.employeeProfile.employeeIdentityId &&
            matchedUser.employeeProfile.employeeIdentityId !== identityId
          )
            throw this.conflict(
              'EMPLOYEE_ACCOUNT_ALREADY_LINKED',
              'The verified account already belongs to a different employee identity.',
            );
          if (matchedUser?.employeeProfile) {
            if (!matchedUser.employeeProfile.employeeIdentityId)
              throw this.conflict(
                'EMPLOYEE_LEGACY_PROFILE_RECONCILIATION_REQUIRED',
                'The verified account belongs to a legacy employee profile without a permanent identity link. Reconcile it before joining.',
              );
            throw this.conflict(
              'EMPLOYEE_ACCOUNT_ALREADY_LINKED',
              'The verified account is linked to an employee profile. Join using that canonical employee identity instead.',
            );
          }
          if (matchedUser)
            throw this.conflict(
              'EMPLOYEE_ACCOUNT_OWNERSHIP_VERIFICATION_REQUIRED',
              'A verified account already uses this contact. Do not add employee access based on contact equality; the candidate must authenticate and complete the approved account-link process before joining.',
            );
        }
        if (!userId && !passwordHash)
          throw new AppException(
            'EMPLOYEE_INITIAL_PASSWORD_REQUIRED',
            'A temporary employee password is required when creating a new login.',
            HttpStatus.BAD_REQUEST,
          );

        if (userId) {
          await tx.user.update({
            where: { id: userId },
            data: {
              ...(userStatus === UserStatus.SUSPENDED
                ? { status: UserStatus.ACTIVE }
                : {}),
              ...(passwordHash ? { passwordHash } : {}),
            },
          });
          await tx.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        } else {
          const createdUser = await tx.user.create({
            data: { passwordHash, status: UserStatus.ACTIVE },
          });
          userId = createdUser.id;
        }
        const existingFieldRole = await tx.userRole.findFirst({
          where: { userId: userId, role: Role.FIELD_EXECUTIVE, salonId: null },
        });
        if (!existingFieldRole)
          await tx.userRole.create({
            data: {
              userId: userId,
              role: Role.FIELD_EXECUTIVE,
              salonId: null,
            },
          });
        const now = input.startedAt ? new Date(input.startedAt) : new Date();
        let profileId = profile?.id;
        if (profile) {
          await tx.employeeProfile.update({
            where: { id: profile.id },
            data: {
              employeeIdentityId: identityId,
              employeeCode: identity.employeeCode,
              fullName: identity.fullName,
              territory: input.territory?.trim() || profile.territory,
            },
          });
        } else {
          const createdProfile = await tx.employeeProfile.create({
            data: {
              userId: userId,
              employeeIdentityId: identityId,
              employeeCode: identity.employeeCode,
              fullName: identity.fullName,
              territory: input.territory?.trim() || null,
              joinedAt: now,
            },
          });
          profileId = createdProfile.id;
        }
        await tx.refreshToken.updateMany({
          where: { userId: userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const latestEpisode = await tx.employeeEmploymentEpisode.aggregate({
          where: { identityId },
          _max: { episodeNumber: true },
        });
        const episode = await tx.employeeEmploymentEpisode.create({
          data: {
            identityId,
            episodeNumber: (latestEpisode._max.episodeNumber ?? 0) + 1,
            startedAt: now,
            offerVersionId: offers[0].id,
          },
        });
        await this.writeEvent(tx, {
          identityId,
          actorUserId,
          eventType: latestEpisode._max.episodeNumber
            ? 'EMPLOYMENT_REJOINED'
            : 'EMPLOYMENT_JOINED',
          entityType: 'EMPLOYMENT_EPISODE',
          entityId: episode.id,
          reason: 'Joining confirmed by authorized HR action.',
          metadata: {
            status: 'ACTIVE',
            employeeCode: identity.employeeCode,
            profileId,
            offerVersionId: offers[0].id,
          },
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
        });
        await this.writeEvent(tx, {
          identityId,
          actorUserId,
          eventType: 'EMPLOYEE_OFFER_STATUS_CHANGED',
          entityType: 'EMPLOYEE_OFFER',
          entityId: offers[0].id,
          metadata: {
            status: EmployeeOfferStatus.JOINED,
            episodeId: episode.id,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getPerson(identityId);
  }

  async exit(
    actorUserId: string,
    identityId: string,
    input: ExitEmployeeInput,
  ): Promise<EmployeeHrTimelineDto> {
    this.assertFeatureEnabled();
    const fingerprint = this.fingerprint({
      action: 'exit-employee',
      identityId,
      input,
    });
    await this.prisma.$transaction(
      async (tx) => {
        if (
          await this.findReplay(
            tx,
            actorUserId,
            input.idempotencyKey,
            fingerprint,
          )
        )
          return;
        await this.lockIdentity(tx, identityId);
        const identity = await tx.employeeIdentity.findUnique({
          where: { id: identityId },
          include: { employeeProfile: { include: { user: true } } },
        });
        if (!identity)
          this.notFound(
            'EMPLOYEE_IDENTITY_NOT_FOUND',
            'Employee identity not found.',
          );
        if (
          !identity.employeeProfile ||
          identity.employeeProfile.user.status !== UserStatus.ACTIVE
        )
          throw this.conflict(
            'EMPLOYEE_NOT_ACTIVE',
            'Only an active employee can be exited.',
          );
        const episodeId = await this.currentEpisodeId(tx, identityId);
        if (!episodeId)
          throw this.conflict(
            'EMPLOYMENT_HISTORY_REVIEW_REQUIRED',
            'The current employment episode is not known.',
          );
        const when = input.occurredAt ? new Date(input.occurredAt) : new Date();
        await tx.user.update({
          where: { id: identity.employeeProfile.userId },
          data: { status: UserStatus.SUSPENDED },
        });
        await tx.refreshToken.updateMany({
          where: { userId: identity.employeeProfile.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.writeEvent(tx, {
          identityId,
          actorUserId,
          eventType: 'EMPLOYMENT_EXITED',
          entityType: 'EMPLOYMENT_EPISODE',
          entityId: episodeId,
          reason: input.reason,
          metadata: {
            status: EmployeeEmploymentStatus.EXITED,
            occurredAt: when.toISOString(),
            sessionsRevoked: true,
          },
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getPerson(identityId);
  }

  async reconcileLegacyEmployment(
    actorUserId: string,
    identityId: string,
    input: ReconcileLegacyEmploymentInput,
  ): Promise<EmployeeHrTimelineDto> {
    this.assertFeatureEnabled();
    const fingerprint = this.fingerprint({
      action: 'reconcile-legacy-employment',
      identityId,
      input,
    });
    await this.prisma.$transaction(
      async (tx) => {
        if (
          await this.findReplay(
            tx,
            actorUserId,
            input.idempotencyKey,
            fingerprint,
          )
        )
          return;
        await this.lockIdentity(tx, identityId);
        const identity = await tx.employeeIdentity.findUnique({
          where: { id: identityId },
          include: {
            employeeProfile: { include: { user: true } },
            episodes: { orderBy: { episodeNumber: 'asc' }, take: 1 },
          },
        });
        if (!identity)
          this.notFound(
            'EMPLOYEE_IDENTITY_NOT_FOUND',
            'Employee identity not found.',
          );
        if (identity.historyStatus === EmployeeIdentityHistoryStatus.COMPLETE)
          throw this.conflict(
            'EMPLOYMENT_HISTORY_ALREADY_RECONCILED',
            'Employment history has already been reviewed.',
          );
        if (!identity.employeeProfile || !identity.episodes.length)
          throw this.conflict(
            'LEGACY_EMPLOYMENT_NOT_FOUND',
            'No legacy employee profile exists to reconcile.',
          );
        const endedAt = input.endedAt ? new Date(input.endedAt) : null;
        if (input.status === EmployeeEmploymentStatus.EXITED && !endedAt)
          throw new AppException(
            'EMPLOYMENT_END_DATE_REQUIRED',
            'An end date is required when reconciling an exited employee.',
            HttpStatus.BAD_REQUEST,
          );
        if (input.status === EmployeeEmploymentStatus.ACTIVE && endedAt)
          throw new AppException(
            'EMPLOYMENT_END_DATE_NOT_ALLOWED',
            'An end date cannot be supplied for an active employee.',
            HttpStatus.BAD_REQUEST,
          );
        await tx.employeeIdentity.update({
          where: { id: identityId },
          data: { historyStatus: EmployeeIdentityHistoryStatus.COMPLETE },
        });
        await this.writeEvent(tx, {
          identityId,
          actorUserId,
          eventType: 'LEGACY_EMPLOYMENT_RECONCILED',
          entityType: 'EMPLOYMENT_EPISODE',
          entityId: identity.episodes[0].id,
          reason: `${input.reason} Evidence reference: ${input.evidenceReference}`,
          metadata: {
            status: input.status,
            startedAt: new Date(input.startedAt).toISOString(),
            endedAt: endedAt?.toISOString() ?? null,
            evidenceReferenceRecorded: true,
          },
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
        });
        if (input.status === EmployeeEmploymentStatus.EXITED) {
          await tx.user.update({
            where: { id: identity.employeeProfile.userId },
            data: { status: UserStatus.SUSPENDED },
          });
          await tx.refreshToken.updateMany({
            where: {
              userId: identity.employeeProfile.userId,
              revokedAt: null,
            },
            data: { revokedAt: new Date() },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getPerson(identityId);
  }

  private async getOffer(offerId: string): Promise<EmployeeOfferVersionDto> {
    const offer = await this.prisma.employeeOfferVersion.findUnique({
      where: { id: offerId },
      include: { identity: true },
    });
    if (!offer)
      this.notFound('EMPLOYEE_OFFER_NOT_FOUND', 'Employee offer not found.');
    const status = await this.latestOfferStatus(
      this.prisma,
      offerId,
      offer.source === 'HR_CREATED'
        ? EmployeeOfferStatus.DRAFT
        : EmployeeOfferStatus.UNKNOWN,
    );
    const issuance = await this.prisma.employeeHrEvent.findFirst({
      where: {
        entityType: 'EMPLOYEE_OFFER',
        entityId: offerId,
        eventType: {
          in: ['EMPLOYEE_OFFER_ISSUED', 'EMPLOYEE_OFFER_HISTORICAL_RECONCILED'],
        },
      },
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true },
    });
    return this.offerDto(
      offer,
      status,
      await this.latestDocumentStatus(this.prisma, offerId),
      offer.sourceOfferDate ?? issuance?.occurredAt ?? null,
    );
  }

  private async getOfferByIdentity(
    offerId: string,
    identityId: string,
  ): Promise<EmployeeOfferVersionDto> {
    const row = await this.getOffer(offerId);
    return {
      ...row,
      employeeCode:
        (
          await this.prisma.employeeIdentity.findUnique({
            where: { id: identityId },
            select: { employeeCode: true },
          })
        )?.employeeCode ?? null,
    };
  }

  private async latestOfferStatus(
    tx: Tx | PrismaService,
    offerId: string,
    fallback: EmployeeOfferStatus,
  ): Promise<EmployeeOfferStatus> {
    const events = await tx.employeeHrEvent.findMany({
      where: {
        entityType: 'EMPLOYEE_OFFER',
        entityId: offerId,
        eventType: {
          in: [
            'EMPLOYEE_OFFER_ISSUED',
            'EMPLOYEE_OFFER_HISTORICAL_RECONCILED',
            'EMPLOYEE_OFFER_STATUS_CHANGED',
          ],
        },
      },
      orderBy: { occurredAt: 'desc' },
      take: 1,
      select: { metadata: true },
    });
    const status = (events[0]?.metadata as Prisma.JsonObject | null)?.status;
    return typeof status === 'string'
      ? (status as EmployeeOfferStatus)
      : fallback;
  }

  private async latestDocumentStatus(
    tx: Tx | PrismaService,
    offerId: string,
  ): Promise<EmployeeOfferDocumentStatus> {
    const events = await tx.employeeHrEvent.findMany({
      where: {
        entityType: 'EMPLOYEE_OFFER',
        entityId: offerId,
        eventType: 'EMPLOYEE_OFFER_DOCUMENT_STATUS_CHANGED',
      },
      orderBy: { occurredAt: 'desc' },
      take: 1,
      select: { metadata: true },
    });
    const status = (events[0]?.metadata as Prisma.JsonObject | null)
      ?.documentStatus;
    return typeof status === 'string'
      ? (status as EmployeeOfferDocumentStatus)
      : EmployeeOfferDocumentStatus.SAVED;
  }

  private async currentEpisodeId(
    tx: Tx,
    identityId: string,
  ): Promise<string | null> {
    const episode = await tx.employeeEmploymentEpisode.findFirst({
      where: { identityId },
      orderBy: { episodeNumber: 'desc' },
    });
    if (!episode) return null;
    const exit = await tx.employeeHrEvent.findFirst({
      where: {
        identityId,
        entityType: 'EMPLOYMENT_EPISODE',
        entityId: episode.id,
        eventType: {
          in: ['EMPLOYMENT_EXITED', 'LEGACY_EMPLOYMENT_RECONCILED'],
        },
      },
      orderBy: { occurredAt: 'desc' },
    });
    if (
      exit?.eventType === 'EMPLOYMENT_EXITED' ||
      (exit?.eventType === 'LEGACY_EMPLOYMENT_RECONCILED' &&
        (exit.metadata as Prisma.JsonObject | null)?.status === 'EXITED')
    )
      return null;
    return episode.id;
  }

  private async findReplay(
    tx: Tx,
    actorUserId: string,
    key: string,
    fingerprint: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fastque_hr_idempotency'), hashtext(${`${actorUserId}:${key}`}))`;
    const event = await tx.employeeHrEvent.findFirst({
      where: { actorUserId, idempotencyKey: key },
    });
    if (!event) return null;
    if (event.requestFingerprint !== fingerprint)
      throw this.conflict(
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used for a different HR request.',
      );
    return event;
  }

  private async retrySerializableConflicts<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const serializationConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';
        if (!serializationConflict || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
    throw new Error('Serializable HR transaction retry exhausted.');
  }

  private async writeEvent(
    tx: Tx,
    input: {
      identityId: string;
      actorUserId: string;
      eventType: string;
      entityType: string;
      entityId: string;
      reason?: string;
      metadata?: Prisma.InputJsonValue;
      idempotencyKey?: string;
      requestFingerprint?: string;
    },
  ) {
    return tx.employeeHrEvent.create({
      data: {
        identityId: input.identityId,
        actorUserId: input.actorUserId,
        eventType: input.eventType,
        entityType: input.entityType,
        entityId: input.entityId,
        ...(input.reason
          ? { reasonCiphertext: this.crypto.encrypt(input.reason) }
          : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
        ...(input.requestFingerprint
          ? { requestFingerprint: input.requestFingerprint }
          : {}),
      },
    });
  }

  private async lockIdentity(tx: Tx, identityId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fastque_hr_identity'), hashtext(${identityId}))`;
  }

  private fingerprint(value: unknown): string {
    return this.crypto.blindIndex('hr-idempotency', stableJson(value));
  }

  private replayIdentityId(event: {
    identityId: string;
    entityType: string;
    entityId: string;
  }): string {
    if (event.entityType === 'EMPLOYEE_IDENTITY') return event.entityId;
    return event.identityId;
  }

  private personDto(row: {
    id: string;
    employeeCode: string | null;
    fullName: string;
    verificationStatus: EmployeeIdentityVerificationStatus;
    historyStatus: EmployeeIdentityHistoryStatus;
    createdAt: Date;
    contacts: Array<{
      kind: EmployeeIdentityContactKind;
      encryptedValue: string;
    }>;
    employeeProfile: { user: { status: UserStatus } } | null;
    episodes: Array<{ id: string; episodeNumber: number }>;
    events: Array<{
      entityId: string;
      eventType: string;
      metadata: Prisma.JsonValue | null;
    }>;
  }): EmployeeIdentityMatchDto {
    const latest = row.episodes.reduce<(typeof row.episodes)[number] | null>(
      (value, episode) =>
        !value || episode.episodeNumber > value.episodeNumber ? episode : value,
      null,
    );
    const latestEvents = latest
      ? row.events.filter((event) => event.entityId === latest.id)
      : [];
    const episodeEvent = latestEvents[latestEvents.length - 1];
    const employmentStatus =
      row.historyStatus !== EmployeeIdentityHistoryStatus.COMPLETE
        ? EmployeeEmploymentStatus.REVIEW_REQUIRED
        : row.employeeProfile?.user.status === UserStatus.ACTIVE
          ? EmployeeEmploymentStatus.ACTIVE
          : episodeEvent?.eventType === 'EMPLOYMENT_EXITED' ||
              (episodeEvent?.metadata as Prisma.JsonObject | null)?.status ===
                EmployeeEmploymentStatus.EXITED
            ? EmployeeEmploymentStatus.EXITED
            : latest
              ? EmployeeEmploymentStatus.REVIEW_REQUIRED
              : null;
    const seen = new Set<string>();
    const contacts = row.contacts.flatMap((contact) => {
      const key = `${contact.kind}:${contact.encryptedValue}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          kind: contact.kind,
          maskedValue: maskContact(
            contact.kind,
            this.crypto.decrypt(contact.encryptedValue),
          ),
        },
      ];
    });
    return {
      id: row.id,
      employeeCode: row.employeeCode,
      fullName: row.fullName,
      verificationStatus: row.verificationStatus,
      historyStatus: row.historyStatus,
      linkedEmployeeProfile: !!row.employeeProfile,
      employmentStatus,
      contacts,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private timelineDto(row: IdentityWithHistory): EmployeeHrTimelineDto {
    const events = row.events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      occurredAt: event.occurredAt.toISOString(),
      reason: event.reasonCiphertext
        ? this.crypto.decrypt(event.reasonCiphertext)
        : null,
      metadata:
        event.metadata &&
        typeof event.metadata === 'object' &&
        !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>)
          : null,
    }));
    const person = this.personDto(row);
    const offers = row.offers.map((offer) => {
      const issuedEvent = events.find(
        (event) =>
          event.entityType === 'EMPLOYEE_OFFER' &&
          event.entityId === offer.id &&
          (event.eventType === 'EMPLOYEE_OFFER_ISSUED' ||
            event.eventType === 'EMPLOYEE_OFFER_HISTORICAL_RECONCILED'),
      );
      return this.offerDto(
        { ...offer, identity: { employeeCode: row.employeeCode } },
        this.latestStatusFromEvents(
          events,
          offer.id,
          offer.source === 'HR_CREATED'
            ? EmployeeOfferStatus.DRAFT
            : EmployeeOfferStatus.UNKNOWN,
        ),
        this.latestDocumentFromEvents(events, offer.id),
        offer.sourceOfferDate ??
          (issuedEvent ? new Date(issuedEvent.occurredAt) : null),
      );
    });
    const employmentEpisodes: EmployeeEmploymentEpisodeDto[] = row.episodes.map(
      (episode) => {
        const episodeEvents = events.filter(
          (event) =>
            event.entityType === 'EMPLOYMENT_EPISODE' &&
            event.entityId === episode.id,
        );
        const exitEvents = episodeEvents.filter(
          (event) =>
            event.eventType === 'EMPLOYMENT_EXITED' ||
            event.eventType === 'LEGACY_EMPLOYMENT_RECONCILED',
        );
        const exit = exitEvents[exitEvents.length - 1];
        const exitMetadata = exit?.metadata;
        const exited =
          exit?.eventType === 'EMPLOYMENT_EXITED' ||
          exitMetadata?.status === EmployeeEmploymentStatus.EXITED;
        const legacyReconciliation = episodeEvents.find(
          (event) => event.eventType === 'LEGACY_EMPLOYMENT_RECONCILED',
        );
        return {
          id: episode.id,
          episodeNumber: episode.episodeNumber,
          startedAt:
            typeof legacyReconciliation?.metadata?.startedAt === 'string'
              ? legacyReconciliation.metadata.startedAt
              : episode.startedAt.toISOString(),
          endedAt:
            exited && typeof exitMetadata?.occurredAt === 'string'
              ? exitMetadata.occurredAt
              : exited && typeof exitMetadata?.endedAt === 'string'
                ? exitMetadata.endedAt
                : null,
          status: exited
            ? EmployeeEmploymentStatus.EXITED
            : row.historyStatus !== EmployeeIdentityHistoryStatus.COMPLETE
              ? EmployeeEmploymentStatus.REVIEW_REQUIRED
              : row.employeeProfile?.user.status === UserStatus.ACTIVE
                ? EmployeeEmploymentStatus.ACTIVE
                : EmployeeEmploymentStatus.REVIEW_REQUIRED,
          offerVersionId: episode.offerVersionId,
        };
      },
    );
    return { person, offers, employmentEpisodes, events };
  }

  private latestStatusFromEvents(
    events: EmployeeHrTimelineDto['events'],
    offerId: string,
    fallback: EmployeeOfferStatus,
  ): EmployeeOfferStatus {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (
        event.entityType === 'EMPLOYEE_OFFER' &&
        event.entityId === offerId &&
        typeof event.metadata?.status === 'string'
      )
        return event.metadata.status as EmployeeOfferStatus;
    }
    return fallback;
  }

  private latestDocumentFromEvents(
    events: EmployeeHrTimelineDto['events'],
    offerId: string,
  ): EmployeeOfferDocumentStatus {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (
        event.entityType === 'EMPLOYEE_OFFER' &&
        event.entityId === offerId &&
        typeof event.metadata?.documentStatus === 'string'
      )
        return event.metadata.documentStatus as EmployeeOfferDocumentStatus;
    }
    return EmployeeOfferDocumentStatus.SAVED;
  }

  private offerDto(
    offer: {
      id: string;
      identityId: string;
      version: number;
      source: string;
      candidateNameSnapshot: string;
      position: string;
      reportingManager: string | null;
      proposedJoiningAt: Date | null;
      compensationTermsCiphertext: string;
      createdAt: Date;
      sourceReference: string | null;
      identity: { employeeCode: string | null };
    },
    status: EmployeeOfferStatus,
    documentStatus: EmployeeOfferDocumentStatus,
    issuedAt: Date | null,
  ): EmployeeOfferVersionDto {
    let compensation: EmployeeOfferVersionDto['compensation'];
    try {
      compensation = JSON.parse(
        this.crypto.decrypt(offer.compensationTermsCiphertext),
      ) as EmployeeOfferVersionDto['compensation'];
    } catch {
      throw this.conflict(
        'EMPLOYEE_OFFER_TERMS_UNAVAILABLE',
        'Offer compensation terms cannot be safely decrypted.',
      );
    }
    const issuedEventDate =
      status === EmployeeOfferStatus.DRAFT ||
      status === EmployeeOfferStatus.UNKNOWN
        ? null
        : (issuedAt?.toISOString() ?? null);
    return {
      id: offer.id,
      identityId: offer.identityId,
      version: offer.version,
      employeeCode: offer.identity.employeeCode,
      source: offer.source as EmployeeOfferVersionDto['source'],
      candidateName: offer.candidateNameSnapshot,
      position: offer.position,
      reportingManager: offer.reportingManager,
      proposedJoiningAt: offer.proposedJoiningAt?.toISOString() ?? null,
      compensation,
      status,
      documentStatus,
      createdAt: offer.createdAt.toISOString(),
      issuedAt: issuedEventDate,
      sourceReference: offer.sourceReference,
    };
  }

  private notFound(code: string, message: string): never {
    throw new AppException(code, message, HttpStatus.NOT_FOUND);
  }

  private conflict(code: string, message: string): AppException {
    return new AppException(code, message, HttpStatus.CONFLICT);
  }

  private assertFeatureEnabled(): void {
    if (process.env.HR_EMPLOYEE_REGISTRY_ENABLED !== 'true') {
      throw new AppException(
        'HR_EMPLOYEE_REGISTRY_DISABLED',
        'The HR employee register is not enabled in this environment.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

function maskContact(kind: EmployeeIdentityContactKind, value: string): string {
  if (kind === EmployeeIdentityContactKind.EMAIL) {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(8, local.length - 1)))}@${domain}`;
  }
  const digits = value.replace(/\D/g, '');
  return `${digits.slice(0, Math.min(2, Math.max(0, digits.length - 4)))}${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-Math.min(2, digits.length))}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
