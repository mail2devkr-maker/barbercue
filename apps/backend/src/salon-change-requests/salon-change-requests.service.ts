import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, SalonChangeField, SalonChangeStatus } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

export const createSalonChangeRequestSchema = z.object({
  field: z.nativeEnum(SalonChangeField),
  value: z
    .string()
    .trim()
    .min(1, 'Enter the corrected text.')
    .max(200, 'Keep it under 200 characters.'),
});
export type CreateSalonChangeRequestInput = z.infer<
  typeof createSalonChangeRequestSchema
>;

export const decideSalonChangeRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(500).optional(),
});
export type DecideSalonChangeRequestInput = z.infer<
  typeof decideSalonChangeRequestSchema
>;

export interface SalonChangeRequestDto {
  id: string;
  salonId: string;
  field: SalonChangeField;
  proposedValue: string;
  previousValue: string | null;
  status: SalonChangeStatus;
  requestedAt: string;
  requestedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

const HISTORY_LIMIT = 30;

/**
 * Owner issue #28. An employee can SUGGEST a correction to the text details of a shop they onboarded; the change reaches
 * the public shop only when that shop's OWNER approves it. The employee never writes to the shop, only to this table.
 * Photos, chairs, prices and contact numbers are deliberately not changeable this way.
 */
@Injectable()
export class SalonChangeRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  private toDto(row: {
    id: string;
    salonId: string;
    field: SalonChangeField;
    proposedValue: string;
    previousValue: string | null;
    status: SalonChangeStatus;
    requestedAt: Date;
    decidedAt: Date | null;
    decisionNote: string | null;
    requestedBy?: { employeeProfile: { fullName: string } | null } | null;
  }): SalonChangeRequestDto {
    return {
      id: row.id,
      salonId: row.salonId,
      field: row.field,
      proposedValue: row.proposedValue,
      previousValue: row.previousValue,
      status: row.status,
      requestedAt: row.requestedAt.toISOString(),
      requestedByName: row.requestedBy?.employeeProfile?.fullName ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionNote: row.decisionNote,
    };
  }

  /** The employee's own onboarded shop for a lead. A lead that is not theirs, or not onboarded, is a plain 404. */
  private async ownShopForLead(
    userId: string,
    leadId: string,
  ): Promise<string> {
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    const lead = profile
      ? await this.prisma.employeeCrmLead.findFirst({
          where: { id: leadId, employeeProfileId: profile.id },
          select: { onboardedSalonId: true },
        })
      : null;
    if (!lead?.onboardedSalonId) {
      throw new AppException(
        'LEAD_NOT_FOUND',
        'Lead not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return lead.onboardedSalonId;
  }

  async listForEmployee(
    userId: string,
    leadId: string,
  ): Promise<SalonChangeRequestDto[]> {
    const salonId = await this.ownShopForLead(userId, leadId);
    const rows = await this.prisma.salonChangeRequest.findMany({
      where: { salonId, requestedByUserId: userId },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
    });
    return rows.map((row) => this.toDto(row));
  }

  async createForEmployee(
    userId: string,
    leadId: string,
    input: CreateSalonChangeRequestInput,
  ): Promise<SalonChangeRequestDto> {
    const salonId = await this.ownShopForLead(userId, leadId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { addressLine: true, localityText: true },
    });
    if (!salon) {
      throw new AppException(
        'LEAD_NOT_FOUND',
        'Lead not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const current =
      input.field === SalonChangeField.ADDRESS_LINE
        ? salon.addressLine
        : salon.localityText;
    if ((current ?? '').trim() === input.value) {
      throw new AppException(
        'CHANGE_REQUEST_NO_CHANGE',
        'That is already what the shop shows.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      const row = await this.prisma.salonChangeRequest.create({
        data: {
          salonId,
          field: input.field,
          proposedValue: input.value,
          previousValue: current ? current.slice(0, 200) : null,
          status: SalonChangeStatus.PENDING,
          pendingSlot: 1,
          requestedByUserId: userId,
        },
      });
      return this.toDto(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppException(
          'CHANGE_REQUEST_PENDING',
          'A change for this detail is already waiting for the owner. Wait for their decision.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async withdrawForEmployee(
    userId: string,
    leadId: string,
    requestId: string,
  ): Promise<SalonChangeRequestDto> {
    const salonId = await this.ownShopForLead(userId, leadId);
    const claimed = await this.prisma.salonChangeRequest.updateMany({
      where: {
        id: requestId,
        salonId,
        requestedByUserId: userId,
        status: SalonChangeStatus.PENDING,
      },
      data: {
        status: SalonChangeStatus.WITHDRAWN,
        pendingSlot: null,
        decidedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      throw new AppException(
        'CHANGE_REQUEST_NOT_FOUND',
        'No waiting request found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.toDto(
      await this.prisma.salonChangeRequest.findUniqueOrThrow({
        where: { id: requestId },
      }),
    );
  }

  async listForOwner(
    userId: string,
    salonId: string,
  ): Promise<SalonChangeRequestDto[]> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    const rows = await this.prisma.salonChangeRequest.findMany({
      where: { salonId },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
      include: {
        requestedBy: {
          select: { employeeProfile: { select: { fullName: true } } },
        },
      },
    });
    // Waiting requests first, then history newest first.
    rows.sort(
      (a, b) =>
        Number(b.status === SalonChangeStatus.PENDING) -
          Number(a.status === SalonChangeStatus.PENDING) ||
        b.requestedAt.getTime() - a.requestedAt.getTime(),
    );
    return rows.map((row) => this.toDto(row));
  }

  async decide(
    userId: string,
    salonId: string,
    requestId: string,
    input: DecideSalonChangeRequestInput,
  ): Promise<SalonChangeRequestDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    const approve = input.decision === 'APPROVE';
    const decided = await this.prisma.$transaction(async (tx) => {
      // Claim first: only one decision can win, and only for THIS shop's waiting request.
      const claimed = await tx.salonChangeRequest.updateMany({
        where: { id: requestId, salonId, status: SalonChangeStatus.PENDING },
        data: {
          status: approve
            ? SalonChangeStatus.APPROVED
            : SalonChangeStatus.REJECTED,
          pendingSlot: null,
          decidedByUserId: userId,
          decidedAt: new Date(),
          decisionNote: input.note ? input.note : null,
        },
      });
      if (claimed.count !== 1) {
        throw new AppException(
          'CHANGE_REQUEST_NOT_FOUND',
          'No waiting request found.',
          HttpStatus.NOT_FOUND,
        );
      }
      const row = await tx.salonChangeRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
      if (approve) {
        await tx.salon.update({
          where: { id: salonId },
          data:
            row.field === SalonChangeField.ADDRESS_LINE
              ? { addressLine: row.proposedValue }
              : { localityText: row.proposedValue },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: approve
            ? 'SALON_CHANGE_REQUEST_APPROVED'
            : 'SALON_CHANGE_REQUEST_REJECTED',
          entityType: 'SalonChangeRequest',
          entityId: row.id,
          metadata: { salonId, field: row.field },
        },
      });
      return row;
    });
    return this.toDto(decided);
  }
}
