import { Test } from '@nestjs/testing';
import { DashboardReviewsService } from './dashboard-reviews.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

function makeReviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    bookingId: 'b1',
    salonId: 's1',
    rating: 5,
    comment: 'Great cut',
    ownerResponse: null,
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    booking: {
      customer: { phone: '+919876543210', email: null },
      service: { name: 'Haircut' },
    },
    ...overrides,
  };
}

describe('DashboardReviewsService', () => {
  let service: DashboardReviewsService;
  let prisma: {
    review: { findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  };
  let salonAccess: { assertAccess: jest.Mock };

  beforeEach(async () => {
    prisma = {
      review: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), update: jest.fn() },
    };
    salonAccess = { assertAccess: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardReviewsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalonAccessService, useValue: salonAccess },
      ],
    }).compile();
    service = moduleRef.get(DashboardReviewsService);
  });

  describe('list', () => {
    it('checks salon access before listing', async () => {
      await service.list('u1', 's1', undefined, undefined);
      expect(salonAccess.assertAccess).toHaveBeenCalledWith('u1', 's1');
    });

    it('maps rows to OwnerReviewDto, including customer contact and service name', async () => {
      prisma.review.findMany.mockResolvedValueOnce([makeReviewRow()]);
      const result = await service.list('u1', 's1', undefined, undefined);
      expect(result.items[0]).toEqual({
        id: 'r1',
        bookingId: 'b1',
        salonId: 's1',
        rating: 5,
        comment: 'Great cut',
        ownerResponse: null,
        createdAt: '2026-06-01T10:00:00.000Z',
        updatedAt: '2026-06-01T10:00:00.000Z',
        customerPhone: '+919876543210',
        customerEmail: null,
        serviceName: 'Haircut',
      });
    });

    it('paginates via nextCursor when there are more results than the page size', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => makeReviewRow({ id: `r${i}` }));
      prisma.review.findMany.mockResolvedValueOnce(rows);
      const result = await service.list('u1', 's1', undefined, '2');
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('r1');
    });
  });

  describe('respond', () => {
    it('checks salon access before responding', async () => {
      prisma.review.findFirst.mockResolvedValue(makeReviewRow());
      prisma.review.update.mockResolvedValue(makeReviewRow({ ownerResponse: 'Thank you!' }));
      await service.respond('u1', 's1', 'r1', 'Thank you!');
      expect(salonAccess.assertAccess).toHaveBeenCalledWith('u1', 's1');
    });

    it('rejects responding to a review that does not belong to this salon', async () => {
      prisma.review.findFirst.mockResolvedValue(null);
      await expect(service.respond('u1', 's1', 'r1', 'Thanks!')).rejects.toMatchObject({
        code: 'REVIEW_NOT_FOUND',
      });
    });

    it('scopes the lookup by both reviewId and salonId', async () => {
      prisma.review.findFirst.mockResolvedValue(makeReviewRow());
      prisma.review.update.mockResolvedValue(makeReviewRow({ ownerResponse: 'Thanks!' }));
      await service.respond('u1', 's1', 'r1', 'Thanks!');
      expect(prisma.review.findFirst).toHaveBeenCalledWith({ where: { id: 'r1', salonId: 's1' } });
      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { ownerResponse: 'Thanks!' },
        include: expect.any(Object),
      });
    });
  });
});
