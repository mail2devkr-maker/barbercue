import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ReviewErrorCode,
  type OwnerReviewDto,
  type PaginatedResult,
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
  ): Promise<PaginatedResult<OwnerReviewDto>> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
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
      items: page.map((r) => this.toOwnerDto(r)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async respond(
    userId: string,
    salonId: string,
    reviewId: string,
    ownerResponse: string,
  ): Promise<OwnerReviewDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
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
      bookingId: review.bookingId,
      salonId: review.salonId,
      rating: review.rating,
      comment: review.comment,
      ownerResponse: review.ownerResponse,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
      customerPhone: review.booking.customer.phone,
      customerEmail: review.booking.customer.email,
      serviceName: review.booking.service.name,
    };
  }
}
