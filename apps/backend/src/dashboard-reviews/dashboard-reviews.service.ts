import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ReviewErrorCode,
  ReviewSource,
  ReviewSourceState,
  type OwnerReviewDto,
  type OwnerReviewsResponseDto,
  type ReviewProfilesResponseDto,
  type ReviewSourceDto,
  type UpdateReviewProfilesInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const reviewInclude = {
  booking: {
    select: {
      customer: { select: { phone: true, email: true } },
      service: { select: { name: true } },
    },
  },
} satisfies Prisma.ReviewInclude;

type ReviewWithDetails = Prisma.ReviewGetPayload<{
  include: typeof reviewInclude;
}>;

/**
 * Owner-side view of Ratings & Reviews (Phase 16) — the response half of what the customer-facing
 * ReviewsService writes. Owner-only (not staff), same PII-sensitivity reasoning as
 * DashboardBookingsController: this list carries customerPhone/customerEmail.
 */
@Injectable()
export class DashboardReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async list(
    userId: string,
    salonId: string,
    cursor: string | undefined,
    limitRaw: string | undefined,
    sourceRaw?: string,
  ): Promise<OwnerReviewsResponseDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const source = this.resolveSource(sourceRaw);
    const profile = await this.prisma.salonReviewProfile.findUnique({
      where: { salonId },
    });
    const sources = this.toSources(profile);
    if (source !== ReviewSource.FASTQUE) {
      // V1 stores vetted outbound links only. Do not imply provider connectivity or fabricate
      // third-party review rows while external OAuth/API integrations remain unconfigured.
      return { source, sources, items: [], nextCursor: null };
    }
    const limit = this.resolveLimit(limitRaw);

    const reviews = await this.prisma.review.findMany({
      where: { salonId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: reviewInclude,
    });
    const hasMore = reviews.length > limit;
    const page = hasMore ? reviews.slice(0, limit) : reviews;
    return {
      source,
      sources,
      items: page.map((r) => this.toOwnerDto(r)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getReviewProfiles(
    userId: string,
    salonId: string,
  ): Promise<ReviewProfilesResponseDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const profile = await this.prisma.salonReviewProfile.findUnique({
      where: { salonId },
    });
    return { sources: this.toSources(profile) };
  }

  async updateReviewProfiles(
    userId: string,
    salonId: string,
    input: UpdateReviewProfilesInput,
  ): Promise<ReviewProfilesResponseDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const update: Prisma.SalonReviewProfileUpdateInput = {};
    const changedProviders: string[] = [];
    if (input.googleUrl !== undefined) {
      update.googleUrl = input.googleUrl;
      changedProviders.push(ReviewSource.GOOGLE);
    }
    if (input.facebookUrl !== undefined) {
      update.facebookUrl = input.facebookUrl;
      changedProviders.push(ReviewSource.FACEBOOK);
    }
    if (input.instagramUrl !== undefined) {
      update.instagramUrl = input.instagramUrl;
      changedProviders.push(ReviewSource.INSTAGRAM);
    }

    const profile = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.salonReviewProfile.upsert({
        where: { salonId },
        create: {
          salonId,
          googleUrl: input.googleUrl ?? null,
          facebookUrl: input.facebookUrl ?? null,
          instagramUrl: input.instagramUrl ?? null,
        },
        update,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'SALON_REVIEW_PROFILES_UPDATED',
          entityType: 'SalonReviewProfile',
          entityId: salonId,
          // URLs are intentionally omitted from immutable audit metadata.
          metadata: { salonId, changedProviders },
        },
      });
      return saved;
    });
    return { sources: this.toSources(profile) };
  }

  async respond(
    userId: string,
    salonId: string,
    reviewId: string,
    ownerResponse: string,
  ): Promise<OwnerReviewDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(
      userId,
      salonId,
    );
    // Scoped by salonId, not just id — a staff/owner at salon A must never respond to a review
    // that belongs to salon B even if they somehow know its id.
    const existing = await this.prisma.review.findFirst({
      where: { id: reviewId, salonId },
    });
    if (!existing) {
      throw new AppException(
        ReviewErrorCode.REVIEW_NOT_FOUND,
        'Review not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { ownerResponse },
      include: reviewInclude,
    });
    // Part 2 — every delegated admin mutation gets an AuditLog row with the real actor; an owner
    // responding to their own shop's review is unchanged (no new logging for that path).
    if (actor === 'PLATFORM_ADMIN') {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ADMIN_REVIEW_RESPONDED',
          entityType: 'Review',
          entityId: reviewId,
          metadata: { salonId },
        },
      });
    }
    return this.toOwnerDto(updated);
  }

  private resolveLimit(limitRaw: string | undefined): number {
    const parsed = limitRaw ? Number(limitRaw) : DEFAULT_PAGE_SIZE;
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
    return Math.min(parsed, MAX_PAGE_SIZE);
  }

  private toOwnerDto(review: ReviewWithDetails): OwnerReviewDto {
    return {
      id: review.id,
      source: ReviewSource.FASTQUE,
      bookingId: review.bookingId,
      salonId: review.salonId,
      rating: review.rating,
      comment: review.comment,
      ownerResponse: review.ownerResponse,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
      customerPhone: review.booking.customer?.phone ?? null,
      customerEmail: review.booking.customer?.email ?? null,
      serviceName: review.booking.service.name,
    };
  }

  private resolveSource(
    sourceRaw?: string,
  ): (typeof ReviewSource)[keyof typeof ReviewSource] {
    const source = sourceRaw ?? ReviewSource.FASTQUE;
    const validSources: readonly string[] = Object.values(ReviewSource);
    if (!validSources.includes(source)) {
      throw new AppException(
        ReviewErrorCode.INVALID_REVIEW_SOURCE,
        'Review source is not supported.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return source as (typeof ReviewSource)[keyof typeof ReviewSource];
  }

  private toSources(
    profile: {
      googleUrl: string | null;
      facebookUrl: string | null;
      instagramUrl: string | null;
    } | null,
  ): ReviewSourceDto[] {
    return [
      {
        source: ReviewSource.FASTQUE,
        state: ReviewSourceState.CONNECTED,
        profileUrl: null,
      },
      {
        source: ReviewSource.GOOGLE,
        state: profile?.googleUrl
          ? ReviewSourceState.LINK_ONLY
          : ReviewSourceState.UNAVAILABLE,
        profileUrl: profile?.googleUrl ?? null,
      },
      {
        source: ReviewSource.FACEBOOK,
        state: profile?.facebookUrl
          ? ReviewSourceState.LINK_ONLY
          : ReviewSourceState.UNAVAILABLE,
        profileUrl: profile?.facebookUrl ?? null,
      },
      {
        source: ReviewSource.INSTAGRAM,
        state: profile?.instagramUrl
          ? ReviewSourceState.LINK_ONLY
          : ReviewSourceState.UNAVAILABLE,
        profileUrl: profile?.instagramUrl ?? null,
      },
    ];
  }
}
