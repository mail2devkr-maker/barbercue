import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { SalonsService } from './salons.service';
import { CitiesService } from './cities.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

function makeSalon(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's1',
    name: 'BarberCue Demo Salon',
    slug: 'barbercue-demo',
    addressLine: '100 Indiranagar 12th Main',
    lat: 12.9716,
    lng: 77.6412,
    city: { slug: 'bengaluru', countryCode: 'IN' },
    currency: 'INR',
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
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    review: { aggregate: jest.Mock };
    service: { aggregate: jest.Mock };
    locality: { findUnique: jest.Mock };
    userRole: { upsert: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let citiesService: {
    findCityBySlugOrThrow: jest.Mock;
    findCityByCountryAndSlugOrThrow: jest.Mock;
  };
  let salonAccess: { assertAccess: jest.Mock };

  beforeEach(async () => {
    prisma = {
      salon: {
        findMany: jest.fn<Promise<unknown[]>, [SalonFindManyArgs]>(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
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
      locality: { findUnique: jest.fn() },
      userRole: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    citiesService = {
      findCityBySlugOrThrow: jest.fn(),
      findCityByCountryAndSlugOrThrow: jest.fn(),
    };
    salonAccess = { assertAccess: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalonsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CitiesService, useValue: citiesService },
        { provide: SalonAccessService, useValue: salonAccess },
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

    // City.slug is unique only per country, so an unscoped filter could match a same-named city
    // in a different country. City/locality pages and the sitemap pass countryCode; free-text
    // search does not, and must keep matching by slug alone exactly as before this field existed.
    it('scopes the city filter to an exact country when countryCode is supplied', async () => {
      prisma.salon.findMany.mockResolvedValue([]);
      await service.search({ city: 'bengaluru', countryCode: 'in' });
      const { where } = prisma.salon.findMany.mock.calls[0][0];
      expect(where.city).toEqual({ slug: 'bengaluru', countryCode: 'IN' });
    });

    it('falls back to matching city by slug alone when no countryCode is given', async () => {
      prisma.salon.findMany.mockResolvedValue([]);
      await service.search({ city: 'bengaluru' });
      const { where } = prisma.salon.findMany.mock.calls[0][0];
      expect(where.city).toEqual({ slug: 'bengaluru' });
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
      citiesService.findCityByCountryAndSlugOrThrow.mockResolvedValue({
        id: 'c1',
        slug: 'bengaluru',
        countryCode: 'IN',
      });
      prisma.salon.findFirst.mockResolvedValue(null);
      await expect(
        service.getProfile('IN', 'bengaluru', 'nonexistent'),
      ).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
    });

    it('maps the full profile shape including services, hours, photos, and reviews', async () => {
      citiesService.findCityByCountryAndSlugOrThrow.mockResolvedValue({
        id: 'c1',
        slug: 'bengaluru',
        countryCode: 'IN',
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

      const profile = await service.getProfile('IN', 'bengaluru', 'barbercue-demo');

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
      citiesService.findCityByCountryAndSlugOrThrow.mockResolvedValue({
        id: 'c1',
        slug: 'bengaluru',
        countryCode: 'IN',
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
      const profile = await service.getProfile('IN', 'bengaluru', 'barbercue-demo');
      expect(profile.services[0].category).toBe('');
    });
  });

  describe('registerSalon', () => {
    const input = {
      name: 'Fresh Cuts & Co.',
      addressLine: '12 MG Road',
      countryCode: 'IN',
      postalCode: '560001',
      lat: 12.97,
      lng: 77.59,
      citySlug: 'bengaluru',
    };

    beforeEach(() => {
      citiesService.findCityBySlugOrThrow.mockResolvedValue({
        id: 'c1',
        slug: 'bengaluru',
        countryCode: 'IN',
      });
    });

    it('creates the salon with a slugified name and grants the caller SALON_OWNER for it', async () => {
      prisma.salon.create.mockResolvedValue({
        id: 's1',
        publicId: 'BC-SHOP-000001',
        slug: 'fresh-cuts-co',
        name: 'Fresh Cuts & Co.',
        status: 'PENDING',
      });

      const result = await service.registerSalon('owner-1', input);

      expect(prisma.salon.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerUserId: 'owner-1',
          slug: 'fresh-cuts-co',
          cityId: 'c1',
          localityId: null,
          status: 'PENDING',
        }),
      });
      expect(prisma.userRole.upsert).toHaveBeenCalledWith({
        where: {
          userId_role_salonId: {
            userId: 'owner-1',
            role: 'SALON_OWNER',
            salonId: 's1',
          },
        },
        update: {},
        create: { userId: 'owner-1', role: 'SALON_OWNER', salonId: 's1' },
      });
      expect(result).toEqual({
        id: 's1',
        publicId: 'BC-SHOP-000001',
        slug: 'fresh-cuts-co',
        name: 'Fresh Cuts & Co.',
        status: 'PENDING',
      });
    });

    it('persists the PIN code and the captured coordinates', async () => {
      prisma.salon.create.mockResolvedValue({
        id: 's1',
        publicId: 'BC-SHOP-000001',
        slug: 'fresh-cuts-co',
        name: 'Fresh Cuts & Co.',
        status: 'PENDING',
      });

      await service.registerSalon('owner-1', input);

      expect(prisma.salon.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          postalCode: '560001',
          lat: 12.97,
          lng: 77.59,
        }),
      });
    });

    // An owner who denies GPS permission (or registers from a desktop) must still get a shop —
    // address + city + PIN identify it. Coordinates must land as NULL, never as 0/0, which is a
    // real location in the Gulf of Guinea and would put the shop on a map thousands of km away.
    it('registers a salon with no coordinates, storing null rather than 0/0', async () => {
      prisma.salon.create.mockResolvedValue({
        id: 's1',
        publicId: 'BC-SHOP-000001',
        slug: 'fresh-cuts-co',
        name: 'Fresh Cuts & Co.',
        status: 'PENDING',
      });
      const { lat: _lat, lng: _lng, ...withoutCoords } = input;

      const result = await service.registerSalon('owner-1', withoutCoords);

      expect(prisma.salon.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          postalCode: '560001',
          lat: null,
          lng: null,
        }),
      });
      expect(result.id).toBe('s1');
    });

    // The client sends countryCode so postal validation can run before any DB lookup. If that
    // were trusted blindly, a caller could pair a lenient country's postal rule with a city in a
    // strict one and slip an invalid postal code past validation.
    it('rejects a countryCode that does not match the resolved city', async () => {
      citiesService.findCityBySlugOrThrow.mockResolvedValue({
        id: 'c1',
        slug: 'bengaluru',
        countryCode: 'IN',
      });

      await expect(
        service.registerSalon('owner-1', { ...input, countryCode: 'GB' }),
      ).rejects.toMatchObject({ code: 'CITY_COUNTRY_MISMATCH' });
      expect(prisma.salon.create).not.toHaveBeenCalled();
    });

    it('stores the currency derived from the city country', async () => {
      prisma.salon.create.mockResolvedValue({
        id: 's1',
        publicId: 'BC-SHOP-000001',
        slug: 'fresh-cuts-co',
        name: 'Fresh Cuts & Co.',
        status: 'PENDING',
      });

      await service.registerSalon('owner-1', input);

      expect(prisma.salon.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ currency: 'INR' }),
      });
    });

    // Nothing can derive an IANA zone at registration yet — GPS is optional and no lookup is
    // wired — so a guessed timezone would be worse than none.
    it('does not invent a timezone at registration', async () => {
      prisma.salon.create.mockResolvedValue({
        id: 's1',
        publicId: 'BC-SHOP-000001',
        slug: 'fresh-cuts-co',
        name: 'Fresh Cuts & Co.',
        status: 'PENDING',
      });

      await service.registerSalon('owner-1', input);

      const [args] = prisma.salon.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(args.data.timezone).toBeUndefined();
    });

    it('throws LOCALITY_NOT_FOUND when localitySlug is given but does not exist in the city', async () => {
      prisma.locality.findUnique.mockResolvedValue(null);
      await expect(
        service.registerSalon('owner-1', { ...input, localitySlug: 'no-such-place' }),
      ).rejects.toMatchObject({ code: 'LOCALITY_NOT_FOUND' });
      expect(prisma.salon.create).not.toHaveBeenCalled();
    });

    it('retries with a suffixed slug on a slug collision and succeeds', async () => {
      prisma.salon.create
        .mockRejectedValueOnce(uniqueConstraintError())
        .mockResolvedValueOnce({
          id: 's2',
          publicId: 'BC-SHOP-000002',
          slug: 'fresh-cuts-co-2',
          name: 'Fresh Cuts & Co.',
          status: 'PENDING',
        });

      const result = await service.registerSalon('owner-1', input);

      expect(prisma.salon.create).toHaveBeenCalledTimes(2);
      expect(prisma.salon.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({ slug: 'fresh-cuts-co-2' }),
      });
      expect(result.slug).toBe('fresh-cuts-co-2');
    });

    it('gives up after MAX_SLUG_ATTEMPTS collisions with a clear error', async () => {
      prisma.salon.create.mockRejectedValue(uniqueConstraintError());
      await expect(service.registerSalon('owner-1', input)).rejects.toThrow();
      expect(prisma.salon.create).toHaveBeenCalledTimes(5);
    });

    it('propagates a non-collision error immediately without retrying', async () => {
      const dbError = new Error('connection lost');
      prisma.salon.create.mockRejectedValueOnce(dbError);
      await expect(service.registerSalon('owner-1', input)).rejects.toBe(dbError);
      expect(prisma.salon.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('listOwned', () => {
    it('scopes to salons owned by the given user', async () => {
      prisma.salon.findMany.mockResolvedValue([
        { id: 's1', publicId: 'BC-SHOP-000001', slug: 'a', name: 'A', status: 'PENDING' },
      ]);
      const result = await service.listOwned('owner-1');
      expect(prisma.salon.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerUserId: 'owner-1' } }),
      );
      expect(result).toEqual([
        { id: 's1', publicId: 'BC-SHOP-000001', slug: 'a', name: 'A', status: 'PENDING' },
      ]);
    });
  });

  describe('getOwnedSalon', () => {
    it('checks salon access before returning the salon', async () => {
      prisma.salon.findUnique.mockResolvedValue({
        id: 's1',
        publicId: 'BC-SHOP-000001',
        slug: 'a',
        name: 'A',
        status: 'PENDING',
      });
      const result = await service.getOwnedSalon('user-1', 's1');
      expect(salonAccess.assertAccess).toHaveBeenCalledWith('user-1', 's1');
      expect(result.publicId).toBe('BC-SHOP-000001');
    });

    it('throws SALON_NOT_FOUND when access is granted but the salon no longer exists', async () => {
      prisma.salon.findUnique.mockResolvedValue(null);
      await expect(service.getOwnedSalon('user-1', 's1')).rejects.toMatchObject({
        code: 'SALON_NOT_FOUND',
      });
    });

    it('propagates the access-denied error without reaching the DB lookup', async () => {
      const denied = new Error('denied');
      salonAccess.assertAccess.mockRejectedValueOnce(denied);
      await expect(service.getOwnedSalon('user-1', 's1')).rejects.toBe(denied);
      expect(prisma.salon.findUnique).not.toHaveBeenCalled();
    });
  });

  // A barber holds no ownership, so listOwned returns nothing for them — this is the only route
  // by which they can discover the salon they work at.
  describe('listWorkplaces', () => {
    const salonRow = (over: Record<string, unknown> = {}) => ({
      id: 's1',
      publicId: 'BC-SHOP-000001',
      slug: 'demo',
      name: 'Demo Salon',
      status: 'ACTIVE',
      ...over,
    });

    it('resolves membership from UserRole, the same rule assertAccess uses', async () => {
      prisma.userRole.findMany.mockResolvedValue([]);

      await service.listWorkplaces('user-1');

      expect(prisma.userRole.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          salonId: { not: null },
          role: { in: ['SALON_STAFF', 'SALON_OWNER'] },
        },
        include: { salon: true },
      });
    });

    it('lists a salon a barber only works at, marked isOwner false', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        { role: 'SALON_STAFF', salon: salonRow() },
      ]);

      const result = await service.listWorkplaces('barber-1');

      expect(result).toEqual([
        {
          id: 's1',
          publicId: 'BC-SHOP-000001',
          slug: 'demo',
          name: 'Demo Salon',
          status: 'ACTIVE',
          isOwner: false,
        },
      ]);
    });

    it('marks an owned salon isOwner true', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        { role: 'SALON_OWNER', salon: salonRow() },
      ]);
      const result = await service.listWorkplaces('owner-1');
      expect(result[0].isOwner).toBe(true);
    });

    // An owner who also cuts hair holds both roles for one salon.
    it('de-duplicates a salon held under both roles and keeps isOwner true', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        { role: 'SALON_STAFF', salon: salonRow() },
        { role: 'SALON_OWNER', salon: salonRow() },
      ]);

      const result = await service.listWorkplaces('owner-barber');

      expect(result).toHaveLength(1);
      expect(result[0].isOwner).toBe(true);
    });

    it('returns an empty list for a user with no salon memberships', async () => {
      prisma.userRole.findMany.mockResolvedValue([]);
      await expect(service.listWorkplaces('customer-1')).resolves.toEqual([]);
    });

    it('skips a membership row whose salon relation is missing', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        { role: 'SALON_STAFF', salon: null },
      ]);
      await expect(service.listWorkplaces('user-1')).resolves.toEqual([]);
    });

    it('sorts by salon name', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        { role: 'SALON_STAFF', salon: salonRow({ id: 'b', name: 'Zen Cuts' }) },
        { role: 'SALON_STAFF', salon: salonRow({ id: 'a', name: 'Ace Salon' }) },
      ]);
      const result = await service.listWorkplaces('barber-1');
      expect(result.map((r) => r.name)).toEqual(['Ace Salon', 'Zen Cuts']);
    });
  });

});
