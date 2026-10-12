import { Test } from '@nestjs/testing';
import { ReviewsService } from './reviews.service';
import { PrismaService } from '../prisma/prisma.service';

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    salonId: 's1',
    customerId: 'c1',
    status: 'COMPLETED',
    ...overrides,
  };
}

function makeReview(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    bookingId: 'b1',
    queueEntryId: null,
    salonId: 's1',
    customerId: 'c1',
    rating: 5,
    comment: 'Great cut',
    ownerResponse: null,
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    booking: { customerId: 'c1', status: 'COMPLETED' },
    queueEntry: null,
    ...overrides,
  };
}

describe('ReviewsService', () => {
  let service: ReviewsService;
  let prisma: {
    booking: { findUnique: jest.Mock };
    queueEntry: { findUnique: jest.Mock };
    review: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      booking: { findUnique: jest.fn() },
      queueEntry: { findUnique: jest.fn() },
      review: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ReviewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ReviewsService);
  });

  describe('create', () => {
    it('rejects a booking that does not belong to the caller as not-found', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        makeBooking({ customerId: 'someone-else' }),
      );
      await expect(
        service.create('c1', { bookingId: 'b1', rating: 5 }),
      ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    });

    it('rejects a booking that has not been completed', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        makeBooking({ status: 'CONFIRMED' }),
      );
      await expect(
        service.create('c1', { bookingId: 'b1', rating: 5 }),
      ).rejects.toMatchObject({ code: 'BOOKING_NOT_COMPLETED' });
    });

    it('rejects a booking that already has a review', async () => {
      prisma.booking.findUnique.mockResolvedValue(makeBooking());
      prisma.review.findUnique.mockResolvedValue(makeReview());
      await expect(
        service.create('c1', { bookingId: 'b1', rating: 5 }),
      ).rejects.toMatchObject({ code: 'REVIEW_ALREADY_EXISTS' });
    });

    it('creates a review scoped to the booking’s own salon and customer', async () => {
      prisma.booking.findUnique.mockResolvedValue(makeBooking());
      prisma.review.findUnique.mockResolvedValue(null);
      prisma.review.create.mockResolvedValue(makeReview());
      const result = await service.create('c1', {
        bookingId: 'b1',
        rating: 5,
        comment: 'Great cut',
      });
      expect(prisma.review.create).toHaveBeenCalledWith({
        data: {
          salonId: 's1',
          customerId: 'c1',
          bookingId: 'b1',
          queueEntryId: null,
          rating: 5,
          comment: 'Great cut',
        },
      });
      expect(result).toEqual({
        id: 'r1',
        bookingId: 'b1',
        queueEntryId: null,
        salonId: 's1',
        rating: 5,
        comment: 'Great cut',
        ownerResponse: null,
        createdAt: '2026-06-01T10:00:00.000Z',
        updatedAt: '2026-06-01T10:00:00.000Z',
      });
    });

    it('requires exactly one visit target', async () => {
      await expect(service.create('c1', { rating: 5 })).rejects.toMatchObject({
        code: 'VISIT_NOT_FOUND',
      });
      await expect(
        service.create('c1', {
          bookingId: 'b1',
          queueEntryId: 'q1',
          rating: 5,
        }),
      ).rejects.toMatchObject({ code: 'VISIT_NOT_FOUND' });
      expect(prisma.booking.findUnique).not.toHaveBeenCalled();
      expect(prisma.queueEntry.findUnique).not.toHaveBeenCalled();
    });

    it('creates a review for the caller’s genuinely completed standalone Live Queue visit', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue({
        id: 'q1',
        salonId: 's2',
        customerId: 'c1',
        bookingId: null,
        source: 'WALK_IN',
        status: 'COMPLETED',
      });
      prisma.review.findUnique.mockResolvedValue(null);
      prisma.review.create.mockResolvedValue(
        makeReview({
          id: 'r2',
          bookingId: null,
          queueEntryId: 'q1',
          salonId: 's2',
          rating: 4,
          comment: 'Good service',
        }),
      );
      const result = await service.create('c1', {
        queueEntryId: 'q1',
        rating: 4,
        comment: 'Good service',
      });
      expect(prisma.review.create).toHaveBeenCalledWith({
        data: {
          salonId: 's2',
          customerId: 'c1',
          bookingId: null,
          queueEntryId: 'q1',
          rating: 4,
          comment: 'Good service',
        },
      });
      expect(result).toMatchObject({
        bookingId: null,
        queueEntryId: 'q1',
        salonId: 's2',
        rating: 4,
      });
    });

    it.each([
      [
        'another customer’s visit',
        {
          customerId: 'c2',
          status: 'COMPLETED',
          source: 'WALK_IN',
          bookingId: null,
        },
        'VISIT_NOT_FOUND',
      ],
      [
        'an anonymous visit',
        {
          customerId: null,
          status: 'COMPLETED',
          source: 'WALK_IN',
          bookingId: null,
        },
        'VISIT_NOT_FOUND',
      ],
      [
        'a booking-linked queue entry',
        {
          customerId: 'c1',
          status: 'COMPLETED',
          source: 'APPOINTMENT',
          bookingId: 'b1',
        },
        'VISIT_NOT_FOUND',
      ],
      [
        'an expired visit',
        {
          customerId: 'c1',
          status: 'EXPIRED',
          source: 'WALK_IN',
          bookingId: null,
        },
        'VISIT_NOT_COMPLETED',
      ],
      [
        'a cancelled visit',
        {
          customerId: 'c1',
          status: 'CANCELLED',
          source: 'WALK_IN',
          bookingId: null,
        },
        'VISIT_NOT_COMPLETED',
      ],
      [
        'a no-show visit',
        {
          customerId: 'c1',
          status: 'NO_SHOW',
          source: 'WALK_IN',
          bookingId: null,
        },
        'VISIT_NOT_COMPLETED',
      ],
      [
        'an active visit',
        {
          customerId: 'c1',
          status: 'WAITING',
          source: 'WALK_IN',
          bookingId: null,
        },
        'VISIT_NOT_COMPLETED',
      ],
    ])('rejects %s', async (_label, entry, code) => {
      prisma.queueEntry.findUnique.mockResolvedValue({
        id: 'q1',
        salonId: 's1',
        ...entry,
      });
      await expect(
        service.create('c1', { queueEntryId: 'q1', rating: 5 }),
      ).rejects.toMatchObject({ code });
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate queue-visit review', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue({
        id: 'q1',
        salonId: 's1',
        customerId: 'c1',
        bookingId: null,
        source: 'WALK_IN',
        status: 'COMPLETED',
      });
      prisma.review.findUnique.mockResolvedValue(
        makeReview({ id: 'r2', bookingId: null, queueEntryId: 'q1' }),
      );
      await expect(
        service.create('c1', { queueEntryId: 'q1', rating: 5 }),
      ).rejects.toMatchObject({ code: 'REVIEW_ALREADY_EXISTS' });
      expect(prisma.review.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects editing a review that does not exist', async () => {
      prisma.review.findUnique.mockResolvedValue(null);
      await expect(
        service.update('c1', 'r1', { rating: 4 }),
      ).rejects.toMatchObject({
        code: 'REVIEW_NOT_FOUND',
      });
    });

    it('rejects editing someone else’s review', async () => {
      prisma.review.findUnique.mockResolvedValue(
        makeReview({ customerId: 'someone-else' }),
      );
      await expect(
        service.update('c1', 'r1', { rating: 4 }),
      ).rejects.toMatchObject({
        code: 'NOT_YOUR_REVIEW',
      });
    });

    it('updates only the fields provided', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview());
      prisma.review.update.mockResolvedValue(makeReview({ rating: 4 }));
      await service.update('c1', 'r1', { rating: 4 });
      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { rating: 4 },
      });
    });

    it('does not allow editing after the underlying queue visit is no longer completed', async () => {
      prisma.review.findUnique.mockResolvedValue(
        makeReview({
          bookingId: null,
          queueEntryId: 'q1',
          booking: null,
          queueEntry: {
            customerId: 'c1',
            bookingId: null,
            source: 'WALK_IN',
            status: 'EXPIRED',
          },
        }),
      );
      await expect(
        service.update('c1', 'r1', { rating: 4 }),
      ).rejects.toMatchObject({
        code: 'VISIT_NOT_COMPLETED',
      });
      expect(prisma.review.update).not.toHaveBeenCalled();
    });
  });

  describe('getForBooking', () => {
    it('returns null when no review exists for the booking', async () => {
      prisma.review.findUnique.mockResolvedValue(null);
      expect(await service.getForBooking('c1', 'b1')).toBeNull();
    });

    it('returns null (never someone else’s review content) when the review belongs to another customer', async () => {
      prisma.review.findUnique.mockResolvedValue(
        makeReview({ customerId: 'someone-else' }),
      );
      expect(await service.getForBooking('c1', 'b1')).toBeNull();
    });

    it('returns the review when it belongs to the caller', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview());
      const result = await service.getForBooking('c1', 'b1');
      expect(result?.id).toBe('r1');
    });
  });

  describe('getForQueueEntry', () => {
    it('returns only the caller’s own Live Queue review', async () => {
      prisma.review.findUnique.mockResolvedValue(
        makeReview({ bookingId: null, queueEntryId: 'q1' }),
      );
      expect(await service.getForQueueEntry('c1', 'q1')).toMatchObject({
        queueEntryId: 'q1',
      });
      expect(await service.getForQueueEntry('c2', 'q1')).toBeNull();
    });
  });
});
