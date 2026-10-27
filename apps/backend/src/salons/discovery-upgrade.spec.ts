import {
  POPULAR_SERVICES,
  SALON_TYPE_FILTER_MATCHES,
  matchesPopularService,
  popularServiceById,
  salonSearchQuerySchema,
  type SalonListItemDto,
} from '@barbercue/shared';
import { SalonsService, nextOpeningOf, sortListItems } from './salons.service';
import { FavoritesService } from './favorites.service';

const item = (over: Partial<SalonListItemDto>): SalonListItemDto =>
  ({
    id: 'x',
    name: 'x',
    ratingAverage: null,
    ratingCount: 0,
    selectedService: null,
    ...over,
  }) as SalonListItemDto;

function salonRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    publicId: `BC-${id}`,
    name: `Salon ${id}`,
    slug: id,
    addressLine: 'Street',
    currency: 'INR',
    postalCode: null,
    lat: null,
    lng: null,
    timezone: 'Asia/Kolkata',
    isClosedForToday: false,
    onlineBookingDiscountPercent: 0,
    salonType: 'UNISEX',
    salonTypeConfirmed: false,
    city: { slug: 'pune', countryCode: 'IN' },
    locality: null,
    photos: [],
    operatingHours: [],
    verification: null,
    ...over,
  };
}

function makeSearchService(
  salons: unknown[],
  matches: unknown[] = [],
  ratings: unknown[] = [],
) {
  const prisma = {
    salon: { findMany: jest.fn().mockResolvedValue(salons) },
    review: { groupBy: jest.fn().mockResolvedValue(ratings) },
    service: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue(matches),
    },
    queueEntry: { groupBy: jest.fn().mockResolvedValue([]) },
    offer: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return {
    prisma,
    service: new SalonsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    ),
  };
}

describe('salon type filter rule', () => {
  it('Male and Female include Unisex; Unisex only matches confirmed Unisex salons', () => {
    expect(SALON_TYPE_FILTER_MATCHES.GENTS).toEqual({
      types: ['GENTS', 'UNISEX'],
      requiresConfirmed: false,
    });
    expect(SALON_TYPE_FILTER_MATCHES.LADIES).toEqual({
      types: ['LADIES', 'UNISEX'],
      requiresConfirmed: false,
    });
    expect(SALON_TYPE_FILTER_MATCHES.UNISEX).toEqual({
      types: ['UNISEX'],
      requiresConfirmed: true,
    });
  });

  it('turns the choice into a where clause (and leaves it out for "All")', async () => {
    const { service, prisma } = makeSearchService([]);
    await service.search({ salonType: 'GENTS' });
    expect(prisma.salon.findMany.mock.calls[0][0].where).toMatchObject({
      salonType: { in: ['GENTS', 'UNISEX'] },
    });
    expect(
      prisma.salon.findMany.mock.calls[0][0].where.salonTypeConfirmed,
    ).toBeUndefined();

    await service.search({ salonType: 'UNISEX' });
    expect(prisma.salon.findMany.mock.calls[1][0].where).toMatchObject({
      salonType: { in: ['UNISEX'] },
      salonTypeConfirmed: true,
    });

    await service.search({});
    expect(
      prisma.salon.findMany.mock.calls[2][0].where.salonType,
    ).toBeUndefined();
  });
});

describe('popular services', () => {
  const haircut = popularServiceById('haircut')!;

  it('matches salon-specific names and skips excluded variants', () => {
    expect(matchesPopularService(haircut, 'Classic Haircut')).toBe(true);
    expect(matchesPopularService(haircut, 'HAIR CUT + wash')).toBe(true);
    expect(matchesPopularService(haircut, 'Kids Haircut')).toBe(false);
    expect(
      matchesPopularService(popularServiceById('detan')!, 'Face De-Tan'),
    ).toBe(true);
    expect(new Set(POPULAR_SERVICES.map((s) => s.id)).size).toBe(
      POPULAR_SERVICES.length,
    );
  });

  it('filters by a matching service whose own price is in range, and reports that price', async () => {
    const { service, prisma } = makeSearchService(
      [salonRow('a'), salonRow('b')],
      [
        // Cheapest first, as the query orders them; only the first per salon counts.
        {
          id: 'svc-a1',
          salonId: 'a',
          name: 'Classic Haircut',
          price: { toString: () => '150' },
          durationMinutes: 30,
        },
        {
          id: 'svc-a2',
          salonId: 'a',
          name: 'Premium Haircut',
          price: { toString: () => '250' },
          durationMinutes: 45,
        },
      ],
    );
    const result = await service.search({
      popularService: 'haircut',
      priceMin: 100,
      priceMax: 300,
    });

    const where = prisma.salon.findMany.mock.calls[0][0].where;
    const condition = JSON.stringify(where.AND);
    expect(condition).toContain('"haircut"');
    expect(condition).toContain('"gte":100');
    expect(condition).toContain('"lte":300');
    // Same row must satisfy match + price: both live inside one services.some(...).
    expect(where.AND[0].services.some.AND).toHaveLength(2);

    const svcQuery = prisma.service.findMany.mock.calls[0][0];
    expect(svcQuery.where.salonId).toEqual({ in: ['a', 'b'] });
    expect(svcQuery.orderBy).toEqual([{ price: 'asc' }, { name: 'asc' }]);
    expect(result.items[0].selectedService).toEqual({
      id: 'svc-a1',
      name: 'Classic Haircut',
      price: 150,
      durationMinutes: 30,
    });
    expect(result.items[1].selectedService).toBeNull();
  });

  it('leaves selectedService out entirely when no popular service is chosen', async () => {
    const { service, prisma } = makeSearchService([salonRow('a')]);
    const result = await service.search({});
    // Only the card's all-services lookup runs — no selected-service lookup.
    expect(prisma.service.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.service.findMany.mock.calls[0][0].where).toEqual({
      salonId: { in: ['a'] },
      isActive: true,
    });
    expect(result.items[0].selectedService).toBeUndefined();
    expect(result.items[0]).toMatchObject({
      salonType: 'UNISEX',
      salonTypeConfirmed: false,
    });
  });
});

describe('sorting', () => {
  it('price sorts by the selected service price, cheapest first, salons without one last', () => {
    const items = [
      item({ id: 'none', selectedService: null }),
      item({
        id: 'p300',
        selectedService: {
          id: '1',
          name: 'Haircut',
          price: 300,
          durationMinutes: 30,
        },
      }),
      item({
        id: 'p120',
        selectedService: {
          id: '2',
          name: 'Haircut',
          price: 120,
          durationMinutes: 30,
        },
      }),
    ];
    expect(sortListItems(items, 'price').map((i) => i.id)).toEqual([
      'p120',
      'p300',
      'none',
    ]);
  });

  it('rating sorts highest first, unrated last, then by review count', () => {
    const items = [
      item({ id: 'new', ratingAverage: null, ratingCount: 0 }),
      item({ id: 'r45few', ratingAverage: 4.5, ratingCount: 2 }),
      item({ id: 'r45many', ratingAverage: 4.5, ratingCount: 40 }),
      item({ id: 'r49', ratingAverage: 4.9, ratingCount: 3 }),
    ];
    expect(sortListItems(items, 'rating').map((i) => i.id)).toEqual([
      'r49',
      'r45many',
      'r45few',
      'new',
    ]);
  });

  it('ranks a bounded candidate set for rating sort and returns one page', async () => {
    const { service, prisma } = makeSearchService(
      [salonRow('low'), salonRow('high')],
      [],
      [
        { salonId: 'low', _avg: { rating: 3.1 }, _count: { rating: 5 } },
        { salonId: 'high', _avg: { rating: 4.8 }, _count: { rating: 9 } },
      ],
    );
    const result = await service.search({ sort: 'rating' });
    expect(prisma.salon.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: { id: 'asc' },
      take: 200,
    });
    expect(result.items.map((i) => i.id)).toEqual(['high', 'low']);
    expect(result.nextCursor).toBeNull();
  });

  it('accepts a price sort without a service, and rejects distance sort without a location', () => {
    expect(salonSearchQuerySchema.safeParse({ sort: 'price' }).success).toBe(
      true,
    );
    expect(salonSearchQuerySchema.safeParse({ sort: 'distance' }).success).toBe(
      false,
    );
    expect(
      salonSearchQuerySchema.safeParse({
        sort: 'distance',
        lat: '12.9',
        lng: '77.6',
      }).success,
    ).toBe(true);
    expect(
      salonSearchQuerySchema.safeParse({ popularService: 'not-a-service' })
        .success,
    ).toBe(false);
    expect(
      salonSearchQuerySchema.safeParse({ salonType: 'OTHER' }).success,
    ).toBe(false);
  });
});

describe('rating, favorites-only and open-now filters', () => {
  const allWeek = (openTime: string, closeTime: string) =>
    Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isClosed: false,
      openTime,
      closeTime,
    }));

  afterEach(() => jest.useRealTimers());

  it('keeps only salons whose average review score reaches the minimum', async () => {
    const { service, prisma } = makeSearchService([]);
    prisma.review.groupBy.mockResolvedValueOnce([{ salonId: 'good' }]);
    await service.search({ minRating: 4 });
    expect(prisma.review.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['salonId'],
      having: { rating: { _avg: { gte: 4 } } },
    });
    expect(prisma.salon.findMany.mock.calls[0][0].where.AND).toContainEqual({
      id: { in: ['good'] },
    });
  });

  it('limits results to the given salon IDs', async () => {
    const { service, prisma } = makeSearchService([]);
    const parsed = salonSearchQuerySchema.parse({
      ids: '11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-222222222222',
    });
    await service.search(parsed);
    expect(prisma.salon.findMany.mock.calls[0][0].where.AND).toContainEqual({
      id: {
        in: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
      },
    });
  });

  it('open now returns only salons open at this moment, as one name-ordered page', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-27T06:30:00Z')); // 12:00 in India
    const { service, prisma } = makeSearchService([
      salonRow('open', { operatingHours: allWeek('09:00', '21:00') }),
      salonRow('later', { operatingHours: allWeek('18:00', '22:00') }),
      salonRow('shut', {
        operatingHours: allWeek('09:00', '21:00'),
        isClosedForToday: true,
      }),
    ]);
    const result = await service.search(
      salonSearchQuerySchema.parse({ openNow: 'true' }),
    );
    expect(prisma.salon.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: { name: 'asc' },
      take: 200,
    });
    expect(result.items.map((i) => i.id)).toEqual(['open']);
    expect(result.items[0]).toMatchObject({
      closesAt: '21:00',
      todayHours: { isClosed: false, openTime: '09:00', closeTime: '21:00' },
    });
    expect(result.nextCursor).toBeNull();
  });

  it('validates the new parameters', () => {
    expect(salonSearchQuerySchema.safeParse({ minRating: '4.5' }).success).toBe(
      true,
    );
    expect(salonSearchQuerySchema.safeParse({ minRating: '6' }).success).toBe(
      false,
    );
    expect(
      salonSearchQuerySchema.safeParse({ ids: 'not-a-uuid' }).success,
    ).toBe(false);
    expect(salonSearchQuerySchema.safeParse({ ids: '' }).success).toBe(false);
    expect(salonSearchQuerySchema.parse({ openNow: 'false' }).openNow).toBe(
      false,
    );
    expect(salonSearchQuerySchema.safeParse({ openNow: 'yes' }).success).toBe(
      false,
    );
  });
});

describe('booking page 3.0: offers filter and new sorts', () => {
  const priced = (
    id: string,
    price: number | null,
    over: Partial<SalonListItemDto> = {},
  ) =>
    item({
      id,
      selectedService:
        price === null
          ? null
          : { id, name: 'Haircut', price, durationMinutes: 30 },
      ...over,
    });
  const offerOn = (
    saving: number,
    offerPrice: number | null,
    conditional = false,
  ) => ({
    offers: [
      {
        saving,
        conditional,
        price: offerPrice === null ? null : { offerPrice },
      } as never,
    ],
  });

  it('price high→low, lowest price after offer, best offer and most reviewed', () => {
    const items = [
      priced('a', 300),
      priced('b', 250, offerOn(100, 150)),
      priced('c', 200, offerOn(150, null, true)),
      priced('none', null),
    ];
    expect(sortListItems(items, 'price_desc').map((i) => i.id)).toEqual([
      'a',
      'b',
      'c',
      'none',
    ]);
    // b: ₹150 after its certain offer beats c's ₹200 (c's offer is conditional).
    expect(sortListItems(items, 'effective_price').map((i) => i.id)).toEqual([
      'b',
      'c',
      'a',
      'none',
    ]);
    // A certain offer ranks above a bigger conditional one; no offer last.
    expect(sortListItems(items, 'offer').map((i) => i.id)).toEqual([
      'b',
      'c',
      'a',
      'none',
    ]);
    expect(
      sortListItems(
        [
          item({ id: 'few', ratingCount: 2, ratingAverage: 5 }),
          item({ id: 'many', ratingCount: 40, ratingAverage: 4.1 }),
        ],
        'reviews',
      ).map((i) => i.id),
    ).toEqual(['many', 'few']);
  });

  it('offers only: a current published offer covering the selected service', async () => {
    const { service, prisma } = makeSearchService([]);
    await service.search(
      salonSearchQuerySchema.parse({
        offersOnly: 'true',
        popularService: 'haircut',
      }),
    );
    const offerClause = prisma.salon.findMany.mock.calls[0][0].where.AND.find(
      (c: Record<string, unknown>) => 'offers' in c,
    );
    expect(offerClause.offers.some).toMatchObject({
      status: 'ACTIVE',
      OR: [
        { services: { none: {} } },
        {
          services: {
            some: { service: expect.objectContaining({ isActive: true }) },
          },
        },
      ],
    });
    expect(offerClause.offers.some.validTo.gt).toBeInstanceOf(Date);
  });

  it('without a service, price sorts rank by starting price', () => {
    for (const sort of ['price', 'price_desc', 'effective_price']) {
      expect(salonSearchQuerySchema.safeParse({ sort }).success).toBe(true);
    }
    const noService = [
      item({ id: 'mid', priceMin: 200, selectedService: undefined }),
      item({ id: 'none', priceMin: null, selectedService: undefined }),
      item({ id: 'low', priceMin: 90, selectedService: undefined }),
      // A certain ₹60 offer price makes this the cheapest after offers.
      item({
        id: 'offer',
        priceMin: 150,
        selectedService: undefined,
        offers: [{ price: { offerPrice: 60 } } as never],
      }),
    ];
    expect(sortListItems(noService, 'price').map((i) => i.id)).toEqual([
      'low',
      'offer',
      'mid',
      'none',
    ]);
    expect(sortListItems(noService, 'price_desc').map((i) => i.id)).toEqual([
      'mid',
      'offer',
      'low',
      'none',
    ]);
    expect(
      sortListItems(noService, 'effective_price').map((i) => i.id),
    ).toEqual(['offer', 'low', 'mid', 'none']);
  });
});

describe('when a closed salon next opens', () => {
  const india = { timezone: 'Asia/Kolkata', city: { countryCode: 'IN' } };
  const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isClosed: dayOfWeek === 3, // closed on Wednesdays
    openTime: '10:00',
  }));

  it('later today, tomorrow, or skips a closed day', () => {
    // Mon 26 Oct 2026, 08:00 IST → opens later today.
    expect(
      nextOpeningOf(hours, india, new Date('2026-10-26T02:30:00Z')),
    ).toEqual({ inDays: 0, dayOfWeek: 1, time: '10:00' });
    // Mon 22:00 IST → tomorrow (Tuesday).
    expect(
      nextOpeningOf(hours, india, new Date('2026-10-26T16:30:00Z')),
    ).toEqual({ inDays: 1, dayOfWeek: 2, time: '10:00' });
    // Tue 22:00 IST → Wednesday is closed, so Thursday.
    expect(
      nextOpeningOf(hours, india, new Date('2026-10-27T16:30:00Z')),
    ).toEqual({ inDays: 2, dayOfWeek: 4, time: '10:00' });
    expect(nextOpeningOf([], india)).toBeNull();
  });
});

describe('FavoritesService', () => {
  function makeFavorites(salonExists = true) {
    const prisma = {
      salon: {
        findFirst: jest
          .fn()
          .mockResolvedValue(salonExists ? { id: 's1' } : null),
      },
      customerFavorite: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([
          { salonId: 's2', createdAt: new Date('2026-10-27T05:00:00Z') },
          { salonId: 's1', createdAt: new Date('2026-10-26T05:00:00Z') },
        ]),
      },
    };
    const salons = {
      listItemsByIds: jest.fn((ids: string[]) =>
        Promise.resolve(ids.map((id) => item({ id }))),
      ),
    };
    return {
      prisma,
      salons,
      favorites: new FavoritesService(prisma as never, salons as never),
    };
  }

  it('adds idempotently for the signed-in user only', async () => {
    const { favorites, prisma } = makeFavorites();
    await expect(favorites.add('user-1', 's1')).resolves.toEqual({
      salonId: 's1',
      favorited: true,
    });
    expect(prisma.customerFavorite.upsert).toHaveBeenCalledWith({
      where: { userId_salonId: { userId: 'user-1', salonId: 's1' } },
      create: { userId: 'user-1', salonId: 's1' },
      update: {},
    });
  });

  it('refuses a salon that is not active', async () => {
    const { favorites, prisma } = makeFavorites(false);
    await expect(favorites.add('user-1', 's9')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.customerFavorite.upsert).not.toHaveBeenCalled();
  });

  it('removes only the caller’s own row, and removing twice is harmless', async () => {
    const { favorites, prisma } = makeFavorites();
    await favorites.remove('user-1', 's1');
    await favorites.remove('user-1', 's1');
    expect(prisma.customerFavorite.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', salonId: 's1' },
    });
  });

  it('lists the caller’s favorites newest first with when they were saved', async () => {
    const { favorites, prisma, salons } = makeFavorites();
    const list = await favorites.list('user-1');
    expect(prisma.customerFavorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(salons.listItemsByIds).toHaveBeenCalledWith(['s2', 's1']);
    expect(list.map((f) => [f.id, f.favoritedAt])).toEqual([
      ['s2', '2026-10-27T05:00:00.000Z'],
      ['s1', '2026-10-26T05:00:00.000Z'],
    ]);
  });
});
