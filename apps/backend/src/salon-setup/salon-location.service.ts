import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LocationVerificationErrorCode,
  Role,
  SalonLocationProposalStatus,
  type AdminSalonLocationProposalDto,
  type DecideSalonLocationProposalInput,
  type PaginatedResult,
  type SalonLocationDto,
  type SalonLocationProposalDto,
  type SubmitSalonLocationProposalInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

const proposalSelect = {
  id: true,
  submittedByUserId: true,
  status: true,
  latitude: true,
  longitude: true,
  source: true,
  submittedAt: true,
  reviewedAt: true,
  reviewNote: true,
} satisfies Prisma.SalonLocationProposalSelect;

const adminProposalInclude = {
  salon: {
    select: {
      id: true,
      publicId: true,
      name: true,
      lat: true,
      lng: true,
      addressLine: true,
      localityText: true,
      postalCode: true,
      city: { select: { name: true } },
    },
  },
} satisfies Prisma.SalonLocationProposalInclude;

type AdminProposalRow = Prisma.SalonLocationProposalGetPayload<{
  include: typeof adminProposalInclude;
}>;

interface PendingCursor {
  status: 'PENDING';
  submittedAt: string;
  id: string;
}

/**
 * Owner location edits are proposals only. The existing public Salon.lat/lng pair changes only in
 * the same transaction as a distinct global PLATFORM_ADMIN's audited approval. A source such as
 * GPS describes how the owner captured a candidate; it is not itself location verification.
 */
@Injectable()
export class SalonLocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async get(userId: string, salonId: string): Promise<SalonLocationDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { id: true, lat: true, lng: true },
    });
    if (!salon) this.throwSalonNotFound();

    const [pending, matchingApproved] = await Promise.all([
      this.prisma.salonLocationProposal.findFirst({
        where: { salonId, status: SalonLocationProposalStatus.PENDING },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        select: proposalSelect,
      }),
      salon.lat !== null && salon.lng !== null
        ? this.prisma.salonLocationProposal.findFirst({
            where: {
              salonId,
              status: SalonLocationProposalStatus.APPROVED,
              latitude: salon.lat,
              longitude: salon.lng,
            },
            orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
            select: { reviewedAt: true },
          })
        : Promise.resolve(null),
    ]);
    const verified = matchingApproved !== null;

    return {
      salonId,
      current: {
        latitude: salon.lat,
        longitude: salon.lng,
        verification: verified ? 'VERIFIED' : 'UNVERIFIED',
        verifiedAt: verified
          ? (matchingApproved.reviewedAt?.toISOString() ?? null)
          : null,
      },
      pendingProposal: pending ? this.toProposalDto(pending) : null,
    };
  }

  async submit(
    userId: string,
    salonId: string,
    input: SubmitSalonLocationProposalInput,
  ): Promise<SalonLocationProposalDto> {
    // A global admin can inspect proposals but cannot submit as the owner whose location is being
    // asserted. This preserves a clean separation between the evidence source and reviewer.
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    try {
      const proposal = await this.prisma.$transaction(
        async (tx) => {
          const salon = await tx.salon.findUnique({
            where: { id: salonId },
            select: { id: true },
          });
          if (!salon) this.throwSalonNotFound();

          const existing = await tx.salonLocationProposal.findFirst({
            where: { salonId, status: SalonLocationProposalStatus.PENDING },
            select: proposalSelect,
          });
          if (
            existing &&
            existing.submittedByUserId === userId &&
            existing.latitude === input.latitude &&
            existing.longitude === input.longitude &&
            existing.source === input.source
          ) {
            return existing;
          }
          let supersededProposalId: string | null = null;
          if (existing) {
            await tx.salonLocationProposal.update({
              where: { id: existing.id },
              data: {
                status: SalonLocationProposalStatus.SUPERSEDED,
                pendingSlot: null,
                reviewNote: 'Superseded by a newer owner proposal.',
              },
            });
            supersededProposalId = existing.id;
          }

          const created = await tx.salonLocationProposal.create({
            data: {
              salonId,
              latitude: input.latitude,
              longitude: input.longitude,
              source: input.source,
              status: SalonLocationProposalStatus.PENDING,
              pendingSlot: 1,
              submittedByUserId: userId,
            },
            select: proposalSelect,
          });
          await tx.auditLog.create({
            data: {
              actorUserId: userId,
              action: 'SALON_LOCATION_PROPOSED',
              entityType: 'SalonLocationProposal',
              entityId: created.id,
              metadata: { salonId, source: input.source },
            },
          });
          if (supersededProposalId) {
            await tx.auditLog.create({
              data: {
                actorUserId: userId,
                action: 'SALON_LOCATION_PROPOSAL_SUPERSEDED',
                entityType: 'SalonLocationProposal',
                entityId: supersededProposalId,
                metadata: { salonId, replacementProposalId: created.id },
              },
            });
          }
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.toProposalDto(proposal);
    } catch (error) {
      if (
        this.isPrismaCode(error, 'P2002') ||
        this.isPrismaCode(error, 'P2034')
      ) {
        throw new AppException(
          LocationVerificationErrorCode.PROPOSAL_CONFLICT,
          'The location proposal changed concurrently. Refresh and retry.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async listPending(
    adminUserId: string,
    cursor: string | undefined,
    limitRaw: string | undefined,
  ): Promise<PaginatedResult<AdminSalonLocationProposalDto>> {
    await this.assertGlobalPlatformAdmin(adminUserId);
    const limit = this.resolveLimit(limitRaw);
    const decoded = cursor ? this.decodeCursor(cursor) : null;
    const cursorWhere = decoded
      ? {
          OR: [
            { submittedAt: { gt: new Date(decoded.submittedAt) } },
            {
              submittedAt: new Date(decoded.submittedAt),
              id: { gt: decoded.id },
            },
          ],
        }
      : {};
    const rows = await this.prisma.salonLocationProposal.findMany({
      where: { status: SalonLocationProposalStatus.PENDING, ...cursorWhere },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include: adminProposalInclude,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((row) => this.toAdminDto(row)),
      nextCursor: hasMore ? this.encodeCursor(page[page.length - 1]) : null,
    };
  }

  async decide(
    adminUserId: string,
    proposalId: string,
    input: DecideSalonLocationProposalInput,
  ): Promise<AdminSalonLocationProposalDto> {
    await this.assertGlobalPlatformAdmin(adminUserId);
    try {
      const row = await this.prisma.$transaction(
        async (tx) => {
          const proposal = await tx.salonLocationProposal.findUnique({
            where: { id: proposalId },
            include: adminProposalInclude,
          });
          if (!proposal) {
            throw new AppException(
              LocationVerificationErrorCode.PROPOSAL_NOT_FOUND,
              'Location proposal not found.',
              HttpStatus.NOT_FOUND,
            );
          }
          if (proposal.submittedByUserId === adminUserId) {
            throw new AppException(
              LocationVerificationErrorCode.REVIEWER_MUST_DIFFER,
              'A location proposal must be reviewed by a different authorized administrator.',
              HttpStatus.FORBIDDEN,
            );
          }
          if (proposal.status !== SalonLocationProposalStatus.PENDING) {
            throw this.proposalConflict();
          }

          const reviewedAt = new Date();
          const nextStatus =
            input.decision === 'APPROVED'
              ? SalonLocationProposalStatus.APPROVED
              : SalonLocationProposalStatus.REJECTED;
          const claimed = await tx.salonLocationProposal.updateMany({
            where: {
              id: proposalId,
              status: SalonLocationProposalStatus.PENDING,
              pendingSlot: 1,
            },
            data: {
              status: nextStatus,
              pendingSlot: null,
              reviewedByAdminId: adminUserId,
              reviewedAt,
              reviewNote: input.note,
            },
          });
          if (claimed.count !== 1) throw this.proposalConflict();

          if (input.decision === 'APPROVED') {
            await tx.salon.update({
              where: { id: proposal.salonId },
              data: { lat: proposal.latitude, lng: proposal.longitude },
            });
          }
          await tx.auditLog.create({
            data: {
              actorUserId: adminUserId,
              action:
                input.decision === 'APPROVED'
                  ? 'SALON_LOCATION_APPROVED'
                  : 'SALON_LOCATION_REJECTED',
              entityType: 'SalonLocationProposal',
              entityId: proposal.id,
              metadata: {
                salonId: proposal.salonId,
                decision: input.decision,
                source: proposal.source,
                note: input.note,
              },
            },
          });
          return tx.salonLocationProposal.findUniqueOrThrow({
            where: { id: proposalId },
            include: adminProposalInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.toAdminDto(row);
    } catch (error) {
      if (
        this.isPrismaCode(error, 'P2034') ||
        this.isPrismaCode(error, 'P2002')
      ) {
        throw this.proposalConflict();
      }
      throw error;
    }
  }

  private async assertGlobalPlatformAdmin(userId: string): Promise<void> {
    const role = await this.prisma.userRole.findFirst({
      where: { userId, role: Role.PLATFORM_ADMIN, salonId: null },
      select: { id: true, user: { select: { status: true } } },
    });
    if (!role || role.user.status !== 'ACTIVE') {
      throw new AppException(
        'SALON_ACCESS_DENIED',
        'A global platform administrator is required.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private resolveLimit(raw: string | undefined): number {
    if (raw === undefined) return DEFAULT_LIMIT;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      throw new AppException(
        'VALIDATION_FAILED',
        `limit must be an integer from 1 to ${MAX_LIMIT}.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return parsed;
  }

  private encodeCursor(row: { id: string; submittedAt: Date }): string {
    return Buffer.from(
      JSON.stringify({
        status: 'PENDING',
        submittedAt: row.submittedAt.toISOString(),
        id: row.id,
      } satisfies PendingCursor),
    ).toString('base64url');
  }

  private decodeCursor(cursor: string): PendingCursor {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Partial<PendingCursor>;
      if (
        decoded.status !== 'PENDING' ||
        typeof decoded.id !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(decoded.id) ||
        typeof decoded.submittedAt !== 'string' ||
        !Number.isFinite(Date.parse(decoded.submittedAt))
      ) {
        throw new Error('Invalid cursor shape');
      }
      return decoded as PendingCursor;
    } catch {
      throw new AppException(
        LocationVerificationErrorCode.CURSOR_INVALID,
        'The location review cursor is invalid. Restart pagination.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private toProposalDto(
    row: Prisma.SalonLocationProposalGetPayload<{
      select: typeof proposalSelect;
    }>,
  ): SalonLocationProposalDto {
    return {
      id: row.id,
      status: row.status,
      latitude: row.latitude,
      longitude: row.longitude,
      source: row.source,
      submittedAt: row.submittedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNote: row.reviewNote,
    };
  }

  private toAdminDto(row: AdminProposalRow): AdminSalonLocationProposalDto {
    return {
      ...this.toProposalDto(row),
      submittedByUserId: row.submittedByUserId,
      salon: {
        id: row.salon.id,
        publicId: row.salon.publicId,
        name: row.salon.name,
        addressLine: row.salon.addressLine,
        localityText: row.salon.localityText,
        postalCode: row.salon.postalCode,
        cityName: row.salon.city.name,
        currentLatitude: row.salon.lat,
        currentLongitude: row.salon.lng,
      },
    };
  }

  private throwSalonNotFound(): never {
    throw new AppException(
      'SALON_NOT_FOUND',
      'Shop not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private proposalConflict(): AppException {
    return new AppException(
      LocationVerificationErrorCode.PROPOSAL_CONFLICT,
      'This location proposal is no longer pending. Refresh the review queue.',
      HttpStatus.CONFLICT,
    );
  }

  private isPrismaCode(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
