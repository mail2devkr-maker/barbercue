import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  HR_EXPECTED_PERFORMANCE_INCENTIVE_MONTHLY_INR,
  type AuthenticatedUser,
  type HrReconciliationImportInput,
  type HrReconciliationItem,
  type HrReconciliationPage,
  type HrReconciliationStatus,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { HrPrivacyService } from './hr-privacy.service';
import { HrCodeAllocator } from './hr-code-allocator.service';
import { HrRegisterService } from './hr-register.service';
import {
  maskEmail,
  nameFirstKey,
  nameKey,
  normalizeEmail,
  toDateOnly,
  fromDateOnly,
} from './hr-register.util';

type Actor = Pick<AuthenticatedUser, 'id' | 'roles'>;

const itemInclude = {
  linkedPerson: { select: { id: true, employeeCode: true, fullName: true } },
} satisfies Prisma.HrReconciliationItemInclude;
type ItemRecord = Prisma.HrReconciliationItemGetPayload<{
  include: typeof itemInclude;
}>;

function mapItem(item: ItemRecord): HrReconciliationItem {
  return {
    id: item.id,
    source: item.source,
    sentOn: fromDateOnly(item.sentOn) ?? '',
    maskedRecipient: item.maskedRecipient,
    candidateLabel: item.candidateLabel,
    printedEmployeeCode: item.printedEmployeeCode,
    possibleDuplicateOf: item.possibleDuplicateOfId,
    acceptanceEvidence: item.acceptanceNote ? 'NOTE' : 'NONE',
    status: item.status,
    linkedPerson: item.linkedPerson,
  };
}

/**
 * Previously emailed offers that were never saved. They are worklist items, NOT people: the register never
 * derives an employee ID from a name or an address. Only a keyed hash and a masked string of the recipient are
 * stored (no raw address), so importing the ten known letters adds no readable personal data.
 */
@Injectable()
export class HrReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: HrPrivacyService,
    private readonly allocator: HrCodeAllocator,
    private readonly register: HrRegisterService,
  ) {}

  private async item(id: string): Promise<ItemRecord> {
    const item = await this.prisma.hrReconciliationItem.findUnique({
      where: { id },
      include: itemInclude,
    });
    if (!item)
      throw new AppException(
        'HR_RECONCILIATION_NOT_FOUND',
        'No such reconciliation item.',
        HttpStatus.NOT_FOUND,
      );
    return item;
  }

  private assertUnverified(item: ItemRecord): void {
    if (item.status !== 'UNVERIFIED') {
      throw new AppException(
        'HR_RECONCILIATION_RESOLVED',
        'This item was already resolved.',
        HttpStatus.CONFLICT,
      );
    }
  }

  async list(
    status: HrReconciliationStatus | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<HrReconciliationPage> {
    let after: { sentOn: Date; id: string } | null = null;
    if (cursor) {
      const [day, id] = Buffer.from(cursor, 'base64url')
        .toString('utf8')
        .split('|');
      if (day && id) after = { sentOn: toDateOnly(day), id };
    }
    const rows = await this.prisma.hrReconciliationItem.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(after
          ? {
              OR: [
                { sentOn: { gt: after.sentOn } },
                { sentOn: after.sentOn, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      include: itemInclude,
      orderBy: [{ sentOn: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(mapItem),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(`${fromDateOnly(last.sentOn)}|${last.id}`).toString(
              'base64url',
            )
          : null,
    };
  }

  /** Idempotent: the same recipient + send date is stored once. Raw addresses are hashed and masked, never kept. */
  async import(
    actor: Actor,
    input: HrReconciliationImportInput,
  ): Promise<{ received: number; created: number }> {
    const rows = input.items.map((entry) => {
      const email = normalizeEmail(entry.recipientEmail);
      return {
        source: entry.source,
        sentOn: toDateOnly(entry.sentOn),
        recipientHash: this.privacy.blindIndex(email),
        maskedRecipient: maskEmail(email),
        candidateLabel: entry.candidateLabel ?? null,
        printedEmployeeCode: entry.printedEmployeeCode ?? null,
        createdById: actor.id,
      };
    });
    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.hrReconciliationItem.createMany({
        data: rows,
        skipDuplicates: true,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'HR_RECONCILIATION_IMPORTED',
          entityType: 'HrReconciliationItem',
          entityId: 'batch',
          metadata: { received: rows.length, created: created.count },
        },
      });
      return created;
    });
    return { received: rows.length, created: result.count };
  }

  async link(
    actor: Actor,
    itemId: string,
    personId: string,
  ): Promise<HrReconciliationItem> {
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.hrReconciliationItem.findUnique({
        where: { id: itemId },
        include: itemInclude,
      });
      if (!item)
        throw new AppException(
          'HR_RECONCILIATION_NOT_FOUND',
          'No such reconciliation item.',
          HttpStatus.NOT_FOUND,
        );
      this.assertUnverified(item);
      const person = await tx.hrPerson.findUnique({ where: { id: personId } });
      if (!person)
        throw new AppException(
          'HR_PERSON_NOT_FOUND',
          'No such person in the HR register.',
          HttpStatus.NOT_FOUND,
        );
      if (
        item.printedEmployeeCode &&
        item.printedEmployeeCode !== person.employeeCode
      ) {
        throw new AppException(
          'HR_PRINTED_CODE_MISMATCH',
          `The letter printed ${item.printedEmployeeCode}; link the person who owns that code.`,
          HttpStatus.CONFLICT,
        );
      }
      await tx.hrReconciliationItem.update({
        where: { id: itemId },
        data: { status: 'LINKED', linkedPersonId: personId },
      });
      await this.register.audit(tx, {
        personId,
        action: 'RECONCILIATION_LINKED',
        subjectKind: 'RECONCILIATION',
        subjectLabel: `Letter sent ${fromDateOnly(item.sentOn)}`,
        actorUserId: actor.id,
        metadata: { itemId },
      });
    });
    return mapItem(await this.item(itemId));
  }

  async markDuplicate(
    actor: Actor,
    itemId: string,
    duplicateOfItemId: string,
  ): Promise<HrReconciliationItem> {
    if (itemId === duplicateOfItemId) {
      throw new AppException(
        'HR_RECONCILIATION_SELF',
        'An item cannot be a duplicate of itself.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.hrReconciliationItem.findUnique({
        where: { id: itemId },
        include: itemInclude,
      });
      if (!item)
        throw new AppException(
          'HR_RECONCILIATION_NOT_FOUND',
          'No such reconciliation item.',
          HttpStatus.NOT_FOUND,
        );
      this.assertUnverified(item);
      const original = await tx.hrReconciliationItem.findUnique({
        where: { id: duplicateOfItemId },
      });
      if (!original || original.status === 'DUPLICATE') {
        throw new AppException(
          'HR_RECONCILIATION_NOT_FOUND',
          'The original letter must be an existing, non-duplicate item.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      await tx.hrReconciliationItem.update({
        where: { id: itemId },
        data: { status: 'DUPLICATE', possibleDuplicateOfId: duplicateOfItemId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'HR_RECONCILIATION_DUPLICATE',
          entityType: 'HrReconciliationItem',
          entityId: itemId,
          metadata: { duplicateOfItemId },
        },
      });
    });
    return mapItem(await this.item(itemId));
  }

  /**
   * Only after HR states the history was checked, and never when the letter printed an ID (that ID must be
   * linked, not replaced). Creates one person with a read-only historical offer record; no login, no PDF.
   */
  async createIdentity(
    actor: Actor,
    itemId: string,
  ): Promise<HrReconciliationItem> {
    await this.prisma.$transaction(
      async (tx) => {
        await this.allocator.lock(tx);
        const item = await tx.hrReconciliationItem.findUnique({
          where: { id: itemId },
          include: itemInclude,
        });
        if (!item)
          throw new AppException(
            'HR_RECONCILIATION_NOT_FOUND',
            'No such reconciliation item.',
            HttpStatus.NOT_FOUND,
          );
        this.assertUnverified(item);
        if (item.printedEmployeeCode) {
          throw new AppException(
            'HR_PRINTED_CODE_MUST_BE_LINKED',
            `The letter printed ${item.printedEmployeeCode}. Link it to that person instead of issuing a new ID.`,
            HttpStatus.CONFLICT,
          );
        }
        if (!item.candidateLabel) {
          throw new AppException(
            'HR_CANDIDATE_NAME_REQUIRED',
            'Record the candidate name from the letter before creating an identity.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const allocated = await this.allocator.nextStandard(tx);
        const person = await tx.hrPerson.create({
          data: {
            employeeCode: allocated.code,
            codeNumber: allocated.number,
            fullName: item.candidateLabel,
            nameKey: nameKey(item.candidateLabel),
            nameFirstKey: nameFirstKey(item.candidateLabel),
            emailHash: item.recipientHash,
            maskedEmail: item.maskedRecipient,
            origin: 'RECONCILIATION',
            createdById: actor.id,
          },
        });
        const episode = await tx.hrEmploymentEpisode.create({
          data: {
            personId: person.id,
            episodeNumber: 1,
            status: 'PENDING_JOIN',
            originatingOfferVersion: 1,
          },
        });
        const sentAt = new Date(`${fromDateOnly(item.sentOn)}T00:00:00+05:30`);
        await tx.hrOfferVersion.create({
          data: {
            personId: person.id,
            episodeId: episode.id,
            version: 1,
            kind: 'FIRST',
            source: 'HISTORICAL_IMPORT',
            status: 'SENT',
            issuedAt: sentAt,
            sentAt,
            createdById: actor.id,
            role: 'Not recorded (letter sent before the register existed)',
            baseSalaryInr: new Prisma.Decimal(0),
            salaryBasis: 'MONTHLY',
            expectedPerformanceIncentiveMonthlyInr:
              HR_EXPECTED_PERFORMANCE_INCENTIVE_MONTHLY_INR,
          },
        });
        await tx.hrReconciliationItem.update({
          where: { id: itemId },
          data: { status: 'IDENTITY_CREATED', linkedPersonId: person.id },
        });
        await this.register.audit(tx, {
          personId: person.id,
          action: 'IDENTITY_CREATED_FROM_RECONCILIATION',
          subjectKind: 'RECONCILIATION',
          subjectLabel: `Letter sent ${fromDateOnly(item.sentOn)}`,
          actorUserId: actor.id,
          metadata: {
            itemId,
            employeeCode: person.employeeCode,
            historyChecked: true,
          },
        });
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    return mapItem(await this.item(itemId));
  }
}
