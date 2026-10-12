import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingStatus,
  QueueEntrySource,
  QueueEntryStatus,
  ReviewErrorCode,
  type CreateReviewInput,
  type ReviewDetailDto,
  type UpdateReviewInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

/**
 * Ratings & Reviews (Phase 16), customer-facing write side. The public read side (aggregate
 * rating, recent ReviewSummaryDto list on a salon's profile page) already existed — see
 * SalonsService.aggregate/getProfile. This is the missing "leave a review" half: exactly one
 * review per booking (Review.bookingId is @unique), only for a booking the caller actually owns
 * and that actually completed.
 */
@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    customerId: string,
    input: CreateReviewInput,
  ): Promise<ReviewDetailDto> {
    if (Boolean(input.bookingId) === Boolean(input.queueEntryId)) {
      throw new AppException(
        ReviewErrorCode.VISIT_NOT_FOUND,
        'Select exactly one visit to review.',
        HttpStatus.BAD_REQUEST,
      );
    }

    let salonId: string;
    let bookingId: string | null = null;
    let queueEntryId: string | null = null;
    if (input.bookingId) {
      const booking = await this.prisma.booking.findUnique({
        where: { id: input.bookingId },
      });
      // Scope existence and ownership together so a foreign booking never leaks via this route.
      if (!booking || booking.customerId !== customerId) {
        throw new AppException(
          ReviewErrorCode.BOOKING_NOT_FOUND,
          'Booking not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (booking.status !== BookingStatus.COMPLETED) {
        throw new AppException(
          ReviewErrorCode.BOOKING_NOT_COMPLETED,
          'Only a completed booking can be reviewed.',
          HttpStatus.CONFLICT,
        );
      }
      salonId = booking.salonId;
      bookingId = booking.id;
    } else {
      const entry = await this.prisma.queueEntry.findUnique({
        where: { id: input.queueEntryId! },
        select: {
          id: true,
          salonId: true,
          customerId: true,
          bookingId: true,
          source: true,
          status: true,
        },
      });
      if (
        !entry ||
        entry.customerId !== customerId ||
        entry.bookingId !== null ||
        entry.source !== QueueEntrySource.WALK_IN
      ) {
        throw new AppException(
          ReviewErrorCode.VISIT_NOT_FOUND,
          'Completed Live Queue visit not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (entry.status !== QueueEntryStatus.COMPLETED) {
        throw new AppException(
          ReviewErrorCode.VISIT_NOT_COMPLETED,
          'Only a completed Live Queue visit can be reviewed.',
          HttpStatus.CONFLICT,
        );
      }
      salonId = entry.salonId;
      queueEntryId = entry.id;
    }

    const existing = bookingId
      ? await this.prisma.review.findUnique({ where: { bookingId } })
      : await this.prisma.review.findUnique({
          where: { queueEntryId: queueEntryId! },
        });
    if (existing) {
      throw new AppException(
        ReviewErrorCode.REVIEW_ALREADY_EXISTS,
        'This visit has already been reviewed.',
        HttpStatus.CONFLICT,
      );
    }

    try {
      const review = await this.prisma.review.create({
        data: {
          salonId,
          customerId,
          bookingId,
          queueEntryId,
          rating: input.rating,
          comment: input.comment ?? null,
        },
      });
      return this.toDetailDto(review);
    } catch (error) {
      // Unique nullable FKs remain the concurrency authority if two client requests race past the
      // friendly read above. Never return raw Prisma/database errors to the customer.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppException(
          ReviewErrorCode.REVIEW_ALREADY_EXISTS,
          'This visit has already been reviewed.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async update(
    customerId: string,
    reviewId: string,
    input: UpdateReviewInput,
  ): Promise<ReviewDetailDto> {
    const review = await this.getOwnedOrThrow(customerId, reviewId);
    const updated = await this.prisma.review.update({
      where: { id: review.id },
      data: {
        ...(input.rating !== undefined ? { rating: input.rating } : {}),
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
      },
    });
    return this.toDetailDto(updated);
  }

  /** Null (not an error) when this booking has no review yet — that is the normal, expected state
   * for most completed bookings, not a failure. Scoped to the caller's own booking only; the
   * owner-facing equivalent is DashboardReviewsService.list, a different endpoint entirely. */
  async getForBooking(
    customerId: string,
    bookingId: string,
  ): Promise<ReviewDetailDto | null> {
    const review = await this.prisma.review.findUnique({
      where: { bookingId },
    });
    if (!review || review.customerId !== customerId) return null;
    return this.toDetailDto(review);
  }

  async getForQueueEntry(
    customerId: string,
    queueEntryId: string,
  ): Promise<ReviewDetailDto | null> {
    const review = await this.prisma.review.findUnique({
      where: { queueEntryId },
    });
    if (!review || review.customerId !== customerId) return null;
    return this.toDetailDto(review);
  }

  private async getOwnedOrThrow(customerId: string, reviewId: string) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        booking: { select: { customerId: true, status: true } },
        queueEntry: {
          select: {
            customerId: true,
            bookingId: true,
            source: true,
            status: true,
          },
        },
      },
    });
    if (!review) {
      throw new AppException(
        ReviewErrorCode.REVIEW_NOT_FOUND,
        'Review not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (review.customerId !== customerId) {
      throw new AppException(
        ReviewErrorCode.NOT_YOUR_REVIEW,
        'You can only edit your own review.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (review.booking) {
      if (review.booking.customerId !== customerId) {
        throw new AppException(
          ReviewErrorCode.REVIEW_NOT_FOUND,
          'Review not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (review.booking.status !== BookingStatus.COMPLETED) {
        throw new AppException(
          ReviewErrorCode.BOOKING_NOT_COMPLETED,
          'Only a completed booking review can be edited.',
          HttpStatus.CONFLICT,
        );
      }
    }
    if (review.queueEntry) {
      if (
        review.queueEntry.customerId !== customerId ||
        review.queueEntry.bookingId !== null ||
        review.queueEntry.source !== QueueEntrySource.WALK_IN
      ) {
        throw new AppException(
          ReviewErrorCode.REVIEW_NOT_FOUND,
          'Review not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (review.queueEntry.status !== QueueEntryStatus.COMPLETED) {
        throw new AppException(
          ReviewErrorCode.VISIT_NOT_COMPLETED,
          'Only a completed Live Queue review can be edited.',
          HttpStatus.CONFLICT,
        );
      }
    }
    return review;
  }

  private toDetailDto(review: {
    id: string;
    bookingId: string | null;
    queueEntryId: string | null;
    salonId: string;
    rating: number;
    comment: string | null;
    ownerResponse: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): ReviewDetailDto {
    return {
      id: review.id,
      bookingId: review.bookingId,
      queueEntryId: review.queueEntryId,
      salonId: review.salonId,
      rating: review.rating,
      comment: review.comment,
      ownerResponse: review.ownerResponse,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }
}
