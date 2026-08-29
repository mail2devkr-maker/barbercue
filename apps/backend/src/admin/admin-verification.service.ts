import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  VerificationErrorCode,
  VerificationStatus,
  type AdminVerificationRequestDto,
  type PaginatedResult,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const requestInclude = {
  salon: { select: { name: true, ownerUserId: true } },
  staff: { select: { displayName: true, salon: { select: { name: true } } } },
  submittedBy: { select: { email: true, phone: true } },
} satisfies Prisma.VerificationRequestInclude;

type RequestWithDetails = Prisma.VerificationRequestGetPayload<{
  include: typeof requestInclude;
}>;

/**
 * PLATFORM_ADMIN review queue for Shop / Barber Verification (Phase 18) — the manual-review half
 * VerificationService's owner-facing submit side needs. No automated approval path exists; every
 * APPROVED/REJECTED outcome is a human admin's explicit decision, logged to AuditLog.
 */
@Injectable()
export class AdminVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    statusFilter: string | undefined,
    cursor: string | undefined,
    limitRaw: string | undefined,
  ): Promise<PaginatedResult<AdminVerificationRequestDto>> {
    const limit = this.resolveLimit(limitRaw);
    const status = this.resolveStatusFilter(statusFilter);

    const rows = await this.prisma.verificationRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { submittedAt: 'asc' }, // oldest-pending-first — a real review queue, not a feed
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: requestInclude,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((r) => this.toDto(r)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getOne(id: string): Promise<AdminVerificationRequestDto> {
    const row = await this.prisma.verificationRequest.findUnique({
      where: { id },
      include: requestInclude,
    });
    if (!row) {
      throw new AppException(
        VerificationErrorCode.VERIFICATION_NOT_FOUND,
        'Verification request not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.toDto(row);
  }

  async startReview(adminUserId: string, id: string): Promise<AdminVerificationRequestDto> {
    const existing = await this.getRowOrThrow(id);
    if (existing.status !== VerificationStatus.SUBMITTED) {
      throw new AppException(
        VerificationErrorCode.INVALID_VERIFICATION_TRANSITION,
        'Only a newly submitted request can be moved to under review.',
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.prisma.verificationRequest.update({
      where: { id },
      data: { status: VerificationStatus.UNDER_REVIEW },
      include: requestInclude,
    });
    await this.logAudit(adminUserId, 'VERIFICATION_REVIEW_STARTED', id, {});
    return this.toDto(updated);
  }

  async decide(
    adminUserId: string,
    id: string,
    decision: typeof VerificationStatus.APPROVED | typeof VerificationStatus.REJECTED,
    reviewNotes: string | undefined,
  ): Promise<AdminVerificationRequestDto> {
    const existing = await this.getRowOrThrow(id);
    if (
      existing.status !== VerificationStatus.SUBMITTED &&
      existing.status !== VerificationStatus.UNDER_REVIEW
    ) {
      throw new AppException(
        VerificationErrorCode.INVALID_VERIFICATION_TRANSITION,
        'This request has already been decided.',
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.prisma.verificationRequest.update({
      where: { id },
      data: {
        status: decision,
        reviewedByAdminId: adminUserId,
        reviewNotes: reviewNotes ?? null,
        reviewedAt: new Date(),
      },
      include: requestInclude,
    });
    await this.logAudit(adminUserId, `VERIFICATION_${decision}`, id, { reviewNotes: reviewNotes ?? null });
    return this.toDto(updated);
  }

  private async getRowOrThrow(id: string) {
    const row = await this.prisma.verificationRequest.findUnique({ where: { id } });
    if (!row) {
      throw new AppException(
        VerificationErrorCode.VERIFICATION_NOT_FOUND,
        'Verification request not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }

  private resolveLimit(limitRaw: string | undefined): number {
    const parsed = limitRaw ? Number(limitRaw) : DEFAULT_PAGE_SIZE;
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
    return Math.min(parsed, MAX_PAGE_SIZE);
  }

  private resolveStatusFilter(raw: string | undefined): VerificationStatus | undefined {
    const values = Object.values(VerificationStatus) as string[];
    return raw && values.includes(raw) ? (raw as VerificationStatus) : undefined;
  }

  private async logAudit(
    actorUserId: string,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType: 'VerificationRequest',
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private toDto(row: RequestWithDetails): AdminVerificationRequestDto {
    return {
      id: row.id,
      subjectType: row.subjectType,
      status: row.status,
      evidenceNotes: row.evidenceNotes,
      evidenceUrls: row.evidenceUrls,
      submittedAt: row.submittedAt.toISOString(),
      reviewNotes: row.reviewNotes,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      salonId: row.salonId,
      salonName: row.salon?.name ?? null,
      staffId: row.staffId,
      staffDisplayName: row.staff?.displayName ?? null,
      staffSalonName: row.staff?.salon.name ?? null,
      submitterEmail: row.submittedBy?.email ?? null,
      submitterPhone: row.submittedBy?.phone ?? null,
    };
  }
}
