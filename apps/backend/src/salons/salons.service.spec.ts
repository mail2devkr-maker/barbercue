import { Test } from '@nestjs/testing';
import { SalonsService } from './salons.service';
import { CitiesService } from './cities.service';
import { PrismaService } from '../prisma/prisma.service';

function makeSalon(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's1',
    name: 'BarberCue Demo Salon',
    slug: 'barbercue-demo',
    addressLine: '100 Indiranagar 12th Main',
    lat: 12.9716,
    lng: 77.6412,
    city: { slug: 'bengaluru' },
    locality: { slug: 'indiranagar' },
    photos: [],
    ...overrides,
  };
}

interface SalonFindManyArgs {
  where: {
    status: string;
    city?: { slug: string };
    locality?: { slug: string };
  };
}

describe('SalonsService', () => {
  let service: SalonsService;
  let prisma: {
    salon: {
      findMany: jest.Mock<Promise<unknown[]>, [SalonFindManyArgs]>;
      findFirst: jest.Mock;
    };
    review: { aggregate: jest.Mock };
    service: { aggregate: jest.Mock };
  };
  let citiesService: { findCityBySlugOrThrow: jest.Mock };

  beforeEach(async () => {
    prisma = {
      salon: {
        findMany: jest.fn<Promise<unknown[]>, [SalonFindManyArgs]>(),
        findFirst: jest.fn(),
      },
      review: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } }),
      },
      service: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _min: { price: null }, _max: { price: null } }),
      },
    };
    citiesService = { findCityBySlugOrThrow: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalonsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CitiesService, useValue: citiesService },
      ],
    }).compile();
    service = moduleRef.get(SalonsService);
  });

  describe('search', () => {
    it('always scopes to ACTIVE salons regardless of filters', async () => {
      prisma.salon.findMany.mockResolvedValue([]);
      await service.search({});
      expect(prisma.salon.findMany.mock.calls[0][0].where.status).toBe(
        'ACTIVE',
      );
    });

    it('filters by city and locality slug when provided', async () => {
      prisma.salon.findMany.mockResolvedValue([]);
      await service.search({ city: 'bengaluru', locality: 'indiranagar' });
      const { where } = prisma.salon.findMany.mock.calls[0][0];
      expect(where.city).toEqual({ slug: 'bengaluru' });
      expect(where.locality).toEqual({ slug: 'indiranagar' });
    });

    it('returns no nextCursor when results fit within the limit', async () => {
      prisma.salon.findMany.mockResolvedValue([makeSalon()]);
      const result = await service.search({ limit: 20 });
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it('returns a nextCursor and trims to `limit` items when there are more results than the page size', async () => {
      const salons = [
        makeSalon({ id: 's1' }),
        makeSalon({ id: 's2' }),
        makeSalon({ id: 's3' }),
      ];
      prisma.salon.findMany.mockResolvedValue(salons); // limit+1 = 3 for limit=2
      const result = await service.search({ limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('s2');
    });

    it('maps Decimal price aggregates to plain numbers', async () => {
      prisma.salon.findMany.mockResolvedValue([makeSalon()]);
      prisma.service.aggregate.mockResolvedValue({
        _min: { price: { toString: () => '300' } },
        _max: { price: { toString: () => '600' } },
      });
      const result = await service.search({});
      expect(result.items[0].priceMin).toBe(300);
      expect(result.items[0].priceMax).toBe(600);
    });
  });

  describe('getProfile', () => {
    it('throws SALON_NOT_FOUND when no ACTIVE salon matches the slug in that city', async () => {
      citiesService.findCityBySlugOrThrow.mockResolvedValue({
        id: 'c1',
        slug: 'bengaluru',
      });
      prisma.salon.findFirst.mockResolvedValue(null);
      await expect(
        service.getProfile('bengaluru', 'nonexistent'),
      ).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
    });

    it('maps the full profile shape including services, hours, photos, and reviews', async () => {
      citiesService.findCityBySlugOrThrow.mockResolvedValue({
        id: 'c1',
        slug: 'bengaluru',
      });
      prisma.salon.findFirst.mockResolvedValue(
        makeSalon({
          description: 'A demo salon',
          phone: '+918041234567',
          services: [
            {
              id: 'sv1',
              salonId: 's1',
              name: 'Haircut',
              durationMinutes: 30,
              price: { toString: () => '300' },
              category: 'Hair',
              isActive: true,
            },
          ],
          operatingHours: [
            {
              dayOfWeek: 1,
              openTime: '09:00',
              closeTime: '20:00',
              isClosed: false,
            },
          ],
          photos: [
            {
              id: 'p1',
              url: 'https://example.com/a.jpg',
              altText: null,
              type: 'COVER',
            },
          ],
          reviews: [
            {
              id: 'r1',
              rating: 5,
              comment: 'Great!',
              createdAt: new Date('2026-01-01T00:00:00Z'),
            },
          ],
        }),
      );
      prisma.review.aggregate.mockResolvedValue({
        _avg: { rating: 5 },
        _count: { rating: 1 },
      });

      const profile = await service.getProfile('bengaluru', 'barbercue-demo');

      expect(profile.services).toEqual([
        {
          id: 'sv1',
          salonId: 's1',
          name: 'Haircut',
          durationMinutes: 30,
          price: 300,
          category: 'Hair',
          isActive: true,
        },
      ]);
      expect(profile.operatingHours).toEqual([
        {
          dayOfWeek: 1,
          openTime: '09:00',
          closeTime: '20:00',
          isClosed: false,
        },
      ]);
      expect(profile.photos[0].url).toBe('https://example.com/a.jpg');
      expect(profile.reviews[0]).toMatchObject({
        rating: 5,
        comment: 'Great!',
      });
      expect(profile.ratingAverage).toBe(5);
      expect(profile.ratingCount).toBe(1);
    });

    it('defaults a null service category to an empty string (schema allows null, DTO does not)', async () => {
      citiesService.findCityBySlugOrThrow.mockResolvedValue({
        id: 'c1',
        slug: 'bengaluru',
      });
      prisma.salon.findFirst.mockResolvedValue(
        makeSalon({
          services: [
            {
              id: 'sv1',
              salonId: 's1',
              name: 'Haircut',
              durationMinutes: 30,
              price: { toString: () => '300' },
              category: null,
              isActive: true,
            },
          ],
          operatingHours: [],
          reviews: [],
        }),
      );
      const profile = await service.getProfile('bengaluru', 'barbercue-demo');
      expect(profile.services[0].category).toBe('');
    });
  });
});
