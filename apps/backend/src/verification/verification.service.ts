import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingErrorCode,
  Role,
  SalonStatus,
  VerificationErrorCode,
  VerificationStatus,
  VerificationSubjectType,
  type SubmitVerificationInput,
  type VerificationRequestDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

type VerificationRow = {
  id: string;
  subjectType: VerificationSubjectType;
  status: VerificationStatus;
  evidenceNotes: string | null;
  evidenceUrls: string[];
  submittedAt: Date;
  reviewNotes: string | null;
  reviewedAt: Date | null;
};

/**
 * Ratings/Reviews-adjacent but distinct concern: Shop / Barber Verification Foundation
 * (Phase 18), owner-facing submit/view side. Deliberately owner-only (never staff) — seeking
 * verification is a business decision, not an operational one, matching how DashboardReviewsController
 * and DashboardBookingsController already restrict PII-adjacent actions to SALON_OWNER.
 *
 * This is a FOUNDATION: evidence is free text plus already-hosted links, reviewed manually by a
 * human PLATFORM_ADMIN. No document upload, no automated checks, no third-party KYC — see
 * VerificationRequest's own schema.prisma doc comment.
 */
@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

  // Part 2 — delegated shop management, read-only oversight only (see this class's own doc
  // comment: submitForSalon/submitForStaff stay owner-only, deliberately not extended here).
  // Deliberately NOT SalonAccessService.assertOwnerOrAdminAccess: that throws a distinct
  // SALON_ACCESS_DENIED for "exists but not yours", where this module's own existing contract
  // (see submitForSalon below, unchanged) always throws the same SALON_NOT_FOUND regardless of
  // which is true, so a caller can never learn a salon they don't own even exists. Preserving that
  // for the new admin-read path means checking admin eligibility inline rather than delegating.
  private async assertOwnerOrGlobalAdmin(
    userId: string,
    salon: { ownerUserId: string; status: SalonStatus },
  ): Promise<void> {
    if (salon.ownerUserId === userId) return;
    if (salon.status === SalonStatus.ACTIVE) {
      const isGlobalAdmin = await this.prisma.userRole.findFirst({
        where: { userId, role: Role.PLATFORM_ADMIN, salonId: null },
      });
      if (isGlobalAdmin) return;
    }
    throw new AppException(
      VerificationErrorCode.SALON_NOT_FOUND,
      'Salon not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  async submitForSalon(
    userId: string,
    salonId: string,
    input: SubmitVerificationInput,
  ): Promise<VerificationRequestDto> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });
    if (!salon || salon.ownerUserId !== userId) {
      throw new AppException(
        VerificationErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const row = await this.upsert({
      subjectType: VerificationSubjectType.SHOP,
      salonId,
      staffId: null,
      submittedByUserId: userId,
      input,
    });
    return this.toDto(row);
  }

  async submitForStaff(
    userId: string,
    salonId: string,
    staffId: string,
    input: SubmitVerificationInput,
  ): Promise<VerificationRequestDto> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });
    if (!salon || salon.ownerUserId !== userId) {
      throw new AppException(
        VerificationErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const staff = await this.prisma.salonStaff.findFirst({
      where: { id: staffId, salonId },
    });
    if (!staff) {
      throw new AppException(
        BookingErrorCode.STAFF_NOT_FOUND,
        'Staff member not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const row = await this.upsert({
      subjectType: VerificationSubjectType.PROFESSIONAL,
      salonId: null,
      staffId,
      submittedByUserId: userId,
      input,
    });
    return this.toDto(row);
  }

  // Part 2 — delegated shop management. Read-only oversight for a global PLATFORM_ADMIN on an
  // ACTIVE salon (viewing a shop's current verification status is what "assist an ACTIVE shop's
  // owner" requires) via assertOwnerOrGlobalAdmin above. Deliberately NOT extended to
  // submitForSalon/submitForStaff below — see this class's own doc comment: seeking verification
  // is the owner's own business decision/attestation, never something an admin submits as if they
  // were the owner.
  async getForSalon(
    userId: string,
    salonId: string,
  ): Promise<VerificationRequestDto | null> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { ownerUserId: true, status: true },
    });
    if (!salon) {
      throw new AppException(
        VerificationErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.assertOwnerOrGlobalAdmin(userId, salon);
    const row = await this.prisma.verificationRequest.findUnique({
      where: { salonId },
    });
    return row ? this.toDto(row) : null;
  }

  async getForStaff(
    userId: string,
    salonId: string,
    staffId: string,
  ): Promise<VerificationRequestDto | null> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { ownerUserId: true, status: true },
    });
    if (!salon) {
      throw new AppException(
        VerificationErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.assertOwnerOrGlobalAdmin(userId, salon);
    const staff = await this.prisma.salonStaff.findFirst({
      where: { id: staffId, salonId },
    });
    if (!staff) {
      throw new AppException(
        BookingErrorCode.STAFF_NOT_FOUND,
        'Staff member not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const row = await this.prisma.verificationRequest.findUnique({
      where: { staffId },
    });
    return row ? this.toDto(row) : null;
  }

  /** Shared create-or-resubmit logic for both subject types. A REJECTED request may be
   * resubmitted (reopens the same row as SUBMITTED, clearing the prior review); a
   * SUBMITTED/UNDER_REVIEW one may not (already pending); an APPROVED one may not (already done).
   * Every transition is also logged to AuditLog so history survives even though this row only
   * ever holds the latest state. */
  private async upsert(args: {
    subjectType: VerificationSubjectType;
    salonId: string | null;
    staffId: string | null;
    submittedByUserId: string;
    input: SubmitVerificationInput;
  }): Promise<VerificationRow> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = args.salonId
          ? await tx.verificationRequest.findUnique({
              where: { salonId: args.salonId },
            })
          : await tx.verificationRequest.findUnique({
              where: { staffId: args.staffId! },
            });

        if (existing) {
          if (existing.status === VerificationStatus.APPROVED) {
            throw new AppException(
              VerificationErrorCode.VERIFICATION_ALREADY_APPROVED,
              'This is already verified.',
              HttpStatus.CONFLICT,
            );
          }
          if (existing.status !== VerificationStatus.REJECTED) {
            throw new AppException(
              VerificationErrorCode.VERIFICATION_ALREADY_PENDING,
              'A verification request is already pending review.',
              HttpStatus.CONFLICT,
            );
          }

          const claim = await tx.verificationRequest.updateMany({
            where: { id: existing.id, status: VerificationStatus.REJECTED },
            data: {
              status: VerificationStatus.SUBMITTED,
              evidenceNotes: args.input.evidenceNotes ?? null,
              evidenceUrls: args.input.evidenceUrls ?? [],
              submittedByUserId: args.submittedByUserId,
              submittedAt: new Date(),
              reviewedByAdminId: null,
              reviewNotes: null,
              reviewedAt: null,
            },
          });
          if (claim.count === 0) {
            throw new AppException(
              VerificationErrorCode.VERIFICATION_ALREADY_PENDING,
              'This request changed while it was being resubmitted. Refresh and try again.',
              HttpStatus.CONFLICT,
            );
          }
          await this.logAudit(
            tx,
            args.submittedByUserId,
            'VERIFICATION_RESUBMITTED',
            existing.id,
            { subjectType: args.subjectType },
          );
          const updated = await tx.verificationRequest.findUnique({
            where: { id: existing.id },
          });
          if (!updated) {
            throw new AppException(
              VerificationErrorCode.VERIFICATION_NOT_FOUND,
              'Verification request not found.',
              HttpStatus.NOT_FOUND,
            );
          }
          return updated;
        }

        const created = await tx.verificationRequest.create({
          data: {
            subjectType: args.subjectType,
            salonId: args.salonId,
            staffId: args.staffId,
            status: VerificationStatus.SUBMITTED,
            evidenceNotes: args.input.evidenceNotes ?? null,
            evidenceUrls: args.input.evidenceUrls ?? [],
            submittedByUserId: args.submittedByUserId,
          },
        });
        await this.logAudit(
          tx,
          args.submittedByUserId,
          'VERIFICATION_SUBMITTED',
          created.id,
          { subjectType: args.subjectType },
        );
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppException(
          VerificationErrorCode.VERIFICATION_ALREADY_PENDING,
          'A verification request is already pending review.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  private async logAudit(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType: 'VerificationRequest',
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private toDto(row: VerificationRow): VerificationRequestDto {
    return {
      id: row.id,
      subjectType: row.subjectType,
      status: row.status,
      evidenceNotes: row.evidenceNotes,
      evidenceUrls: row.evidenceUrls,
      submittedAt: row.submittedAt.toISOString(),
      reviewNotes: row.reviewNotes,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    };
  }
}
