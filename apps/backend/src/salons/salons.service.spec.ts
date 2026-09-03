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
    operatingHours: [],
    staff: [],
    verification: null,
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
      userRole: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
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

    // Issue #13 Mission D: the "Shop or service" field previously only matched salon
    // name/description, so typing a real service name (e.g. "beard") for a shop that genuinely
    // offers it returned zero results.
    it('matches q against service name/category, not just salon name/description', async () => {
      prisma.salon.findMany.mockResolvedValue([]);
      await service.search({ q: 'bear' });
      const { where } = prisma.salon.findMany.mock.calls[0][0] as {
        where: { OR?: Record<string, unknown>[] };
      };
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { name: { contains: 'bear', mode: 'insensitive' } },
          { description: { contains: 'bear', mode: 'insensitive' } },
          {
            services: {
              some: {
                isActive: true,
                OR: [
                  { name: { contains: 'bear', mode: 'insensitive' } },
                  { category: { contains: 'bear', mode: 'insensitive' } },
                ],
              },
            },
          },
        ]),
      );
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

    it('leaves distanceKm null when no lat/lng is supplied', async () => {
      prisma.salon.findMany.mockResolvedValue([makeSalon()]);
      const result = await service.search({});
      expect(result.items[0].distanceKm).toBeNull();
    });

    describe('"near me" (lat/lng supplied)', () => {
      it('sorts results by ascending distance and always returns a null nextCursor', async () => {
        const near = makeSalon({ id: 'near', lat: 12.9716, lng: 77.6412 }); // ~0km from query point
        const far = makeSalon({ id: 'far', lat: 13.5, lng: 78.5 }); // well outside Bengaluru
        prisma.salon.findMany.mockResolvedValue([far, near]);
        const result = await service.search({ lat: 12.9716, lng: 77.6412 });
        expect(result.items.map((i) => i.id)).toEqual(['near', 'far']);
        expect(result.items[0].distanceKm).toBeCloseTo(0, 0);
        expect(result.nextCursor).toBeNull();
      });

      it('excludes salons with no coordinates rather than crashing or showing a fake 0', async () => {
        const noCoords = makeSalon({ id: 'no-coords', lat: null, lng: null });
        prisma.salon.findMany.mockResolvedValue([noCoords]);
        const result = await service.search({ lat: 12.9716, lng: 77.6412 });
        expect(result.items).toHaveLength(0);
      });

      it('does not send a cursor/orderBy to Prisma in near-me mode (in-memory sort instead)', async () => {
        prisma.salon.findMany.mockResolvedValue([]);
        await service.search({
          lat: 12.9716,
          lng: 77.6412,
          cursor: 'ignored-in-near-me-mode',
        });
        const call = prisma.salon.findMany.mock
          .calls[0][0] as unknown as Record<string, unknown>;
        expect(call.cursor).toBeUndefined();
      });

      // A salon with no usable coordinates can never get a distance and is always dropped by the
      // distanceKm-not-null filter — so fetching it into the bounded NEAR_ME_CANDIDATE_CAP
      // candidate set only ever wastes a slot. At real scale (200+ coordinate-less salons in a
      // city, say) an unfiltered query could fill the entire capped set with rows that were
      // always going to be discarded, silently returning zero results even when real
      // coordinate-bearing salons exist and match every other filter.
      it('filters coordinate-less salons out of the candidate query itself, not just the final result', async () => {
        prisma.salon.findMany.mockResolvedValue([]);
        await service.search({ lat: 12.9716, lng: 77.6412 });
        const call = prisma.salon.findMany.mock.calls[0][0] as unknown as {
          where: {
            lat: { not: null; gte: number; lte: number };
            lng: { not: null; gte: number; lte: number };
          };
          take: number;
        };
        expect(call.where.lat.not).toBeNull();
        expect(call.where.lng.not).toBeNull();
        // The full candidate cap is spent entirely on rows that can actually appear in the
        // distance-sorted result — this is what actually prevents the crowding-out bug once the
        // coordinate filter above is applied at the database level.
        expect(call.take).toBe(200);
      });

      it('still considers every coordinate-bearing salon even when many others in the same query have none', async () => {
        // The mock can't simulate a real WHERE filter (bounding box or coordinate-not-null), so
        // this proves the *other* half of the fix: every candidate the DB actually returns is
        // still correctly distance-sorted and included, none silently dropped just for being one
        // of many. Real bounding-box exclusion of a truly distant salon is covered separately below.
        const far = makeSalon({ id: 'far', lat: 20.0, lng: 80.0 });
        const near = makeSalon({ id: 'near', lat: 12.9716, lng: 77.6412 });
        const mid = makeSalon({ id: 'mid', lat: 13.2, lng: 77.8 });
        prisma.salon.findMany.mockResolvedValue([far, near, mid]);
        const result = await service.search({ lat: 12.9716, lng: 77.6412 });
        expect(result.items.map((i) => i.id)).toEqual(['near', 'mid', 'far']);
      });

      it('sizes the initial bounding box from the query point, not a fixed offset', async () => {
        prisma.salon.findMany.mockResolvedValue([
          makeSalon(),
          makeSalon(),
          makeSalon(),
        ]);
        // Two query points far enough apart (different cities) that a fixed-size box bug (e.g.
        // reusing one city's box for another) would produce identical bounds either way — this
        // instead asserts the bounds are actually a function of each query's own lat/lng.
        await service.search({ lat: 12.9716, lng: 77.6412 }); // Bengaluru
        const bengaluruBox = prisma.salon.findMany.mock
          .calls[0][0] as unknown as {
          where: {
            lat: { gte: number; lte: number };
            lng: { gte: number; lte: number };
          };
        };
        prisma.salon.findMany.mockClear();
        await service.search({ lat: 28.6139, lng: 77.209 }); // Delhi
        const delhiBox = prisma.salon.findMany.mock.calls[0][0] as unknown as {
          where: {
            lat: { gte: number; lte: number };
            lng: { gte: number; lte: number };
          };
        };
        expect(bengaluruBox.where.lat.gte).not.toBeCloseTo(
          delhiBox.where.lat.gte,
          1,
        );
        // Bengaluru (~13°N) and Delhi (~28°N) sit at different latitudes, so a correct box (which
        // narrows longitude by cos(latitude)) gives them different-width longitude spans — a bug
        // that used a fixed km-per-degree-longitude regardless of latitude would make these equal.
        const bengaluruLngSpan =
          bengaluruBox.where.lng.lte - bengaluruBox.where.lng.gte;
        const delhiLngSpan = delhiBox.where.lng.lte - delhiBox.where.lng.gte;
        expect(bengaluruLngSpan).not.toBeCloseTo(delhiLngSpan, 3);
      });

      it('cannot let a salon outside the bounding box crowd out one inside it, even with 200+ distant coordinate-bearing rows', async () => {
        // Simulates the real WHERE clause: only rows whose lat/lng actually fall inside the box
        // this specific call requested are returned — exactly what Postgres would do, unlike the
        // other tests here (which use a single fixed mock and so can't exercise this distinction).
        const from = { lat: 12.9716, lng: 77.6412 }; // Bengaluru
        const near = makeSalon({ id: 'near', lat: 12.98, lng: 77.65 }); // ~1.5km away
        // 200 salons scattered around a totally different part of the world (Delhi), each with
        // real, valid coordinates — under the pre-fix "coordinate-bearing only" filter these could
        // fill the entire NEAR_ME_CANDIDATE_CAP before the query ever reached `near`.
        const farAway = Array.from({ length: 200 }, (_, i) =>
          makeSalon({ id: `far-${i}`, lat: 28.6139 + i * 0.001, lng: 77.209 }),
        );
        prisma.salon.findMany.mockImplementation((args: SalonFindManyArgs) => {
          const latFilter = (
            args.where as unknown as { lat?: { gte: number; lte: number } }
          ).lat;
          const lngFilter = (
            args.where as unknown as { lng?: { gte: number; lte: number } }
          ).lng;
          const inBox = (s: ReturnType<typeof makeSalon>) =>
            !!latFilter &&
            !!lngFilter &&
            s.lat >= latFilter.gte &&
            s.lat <= latFilter.lte &&
            s.lng >= lngFilter.gte &&
            s.lng <= lngFilter.lte;
          return Promise.resolve([...farAway, near].filter(inBox));
        });
        const result = await service.search({ lat: from.lat, lng: from.lng });
        expect(result.items.map((i) => i.id)).toContain('near');
      });

      it('excludes a salon with only one of lat/lng set (malformed/partial coordinates), not just fully-null', async () => {
        const partial = makeSalon({ id: 'partial', lat: 12.9716, lng: null });
        prisma.salon.findMany.mockResolvedValue([partial]);
        const result = await service.search({ lat: 12.9716, lng: 77.6412 });
        expect(result.items).toHaveLength(0);
      });

      it('does not enter near-me mode at all when only one of lat/lng is supplied in the query', async () => {
        prisma.salon.findMany.mockResolvedValue([makeSalon()]);
        await service.search({ lat: 12.9716 });
        const call = prisma.salon.findMany.mock.calls[0][0] as unknown as {
          where: Record<string, unknown>;
        };
        // Falls through to the ordinary cursor-paginated path — no coordinate filter applied.
        expect(call.where.lat).toBeUndefined();
      });

      it('breaks an exact distance tie deterministically by id, not by incidental row order', async () => {
        // Both salons are equidistant from the query point (same lat/lng as each other).
        const b = makeSalon({ id: 'b-salon', lat: 13.0, lng: 78.0 });
        const a = makeSalon({ id: 'a-salon', lat: 13.0, lng: 78.0 });
        // mockResolvedValue (not Once): fewer than `limit` candidates triggers the box-widening
        // retry loop, which would call findMany again — a single queued Once-value would leave
        // that retry with nothing mocked and throw on `.length` of undefined.
        prisma.salon.findMany.mockResolvedValue([b, a]);
        const first = await service.search({ lat: 12.9716, lng: 77.6412 });
        prisma.salon.findMany.mockResolvedValue([a, b]);
        const second = await service.search({ lat: 12.9716, lng: 77.6412 });
        // Same tie-break result regardless of which order Prisma happened to return the rows in.
        expect(first.items.map((i) => i.id)).toEqual(['a-salon', 'b-salon']);
        expect(second.items.map((i) => i.id)).toEqual(['a-salon', 'b-salon']);
      });
    });
  });

  describe('getPublicStatus', () => {
    it('returns active chair and aggregate queue counts without customer data', async () => {
      citiesService.findCityByCountryAndSlugOrThrow.mockResolvedValue({
        id: 'city-1',
      });
      prisma.salon.findFirst.mockResolvedValue({
        chairs: [{ id: 'chair-1' }, { id: 'chair-2' }],
        staff: [
          { displayName: 'Ravi', _count: { queueEntriesAssigned: 2 } },
          { displayName: 'Aman', _count: { queueEntriesAssigned: 0 } },
        ],
      });

      await expect(
        service.getPublicStatus('IN', 'bengaluru', 'demo'),
      ).resolves.toEqual({
        activeChairCount: 2,
        professionals: [
          { displayName: 'Ravi', activeQueueCount: 2 },
          { displayName: 'Aman', activeQueueCount: 0 },
        ],
      });
      const query = prisma.salon.findFirst.mock.calls[0][0];
      expect(query.select.staff.select).not.toHaveProperty('user');
      expect(query.select.staff.select).not.toHaveProperty(
        'queueEntriesAssigned',
      );
      expect(
        query.select.staff.select._count.select.queueEntriesAssigned.where
          .status.in,
      ).toEqual(['WAITING', 'CALLED', 'IN_SERVICE']);
    });

    it('does not expose non-active chairs or staff', async () => {
      citiesService.findCityByCountryAndSlugOrThrow.mockResolvedValue({
        id: 'city-1',
      });
      prisma.salon.findFirst.mockResolvedValue({ chairs: [], staff: [] });

      await expect(
        service.getPublicStatus('IN', 'bengaluru', 'demo'),
      ).resolves.toEqual({
        activeChairCount: 0,
        professionals: [],
      });
      const query = prisma.salon.findFirst.mock.calls[0][0];
      expect(query.select.chairs.where).toEqual({ status: 'ACTIVE' });
      expect(query.select.staff.where).toEqual({ status: 'ACTIVE' });
    });

    it('returns not found for a non-active or unknown salon', async () => {
      citiesService.findCityByCountryAndSlugOrThrow.mockResolvedValue({
        id: 'city-1',
      });
      prisma.salon.findFirst.mockResolvedValue(null);

      await expect(
        service.getPublicStatus('IN', 'bengaluru', 'missing'),
      ).rejects.toMatchObject({
        code: 'SALON_NOT_FOUND',
      });
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

      const profile = await service.getProfile(
        'IN',
        'bengaluru',
        'barbercue-demo',
      );

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
      const profile = await service.getProfile(
        'IN',
        'bengaluru',
        'barbercue-demo',
      );
      expect(profile.services[0].category).toBe('');
    });

    it('maps ACTIVE staff to the public team list (Phase 17)', async () => {
      citiesService.findCityByCountryAndSlugOrThrow.mockResolvedValue({
        id: 'c1',
        slug: 'bengaluru',
        countryCode: 'IN',
      });
      prisma.salon.findFirst.mockResolvedValue(
        makeSalon({
          services: [],
          operatingHours: [],
          reviews: [],
          staff: [
            {
              id: 'st1',
              displayName: 'Marcus',
              roleInSalon: 'BARBER',
              photoUrl: 'https://example.com/marcus.jpg',
              bio: 'Fades and tapers specialist.',
              yearsExperience: 8,
              verification: { status: 'APPROVED' },
            },
          ],
        }),
      );
      const profile = await service.getProfile(
        'IN',
        'bengaluru',
        'barbercue-demo',
      );
      expect(profile.team).toEqual([
        {
          id: 'st1',
          verified: true,
          displayName: 'Marcus',
          roleInSalon: 'BARBER',
          photoUrl: 'https://example.com/marcus.jpg',
          bio: 'Fades and tapers specialist.',
          yearsExperience: 8,
        },
      ]);
    });

    // isOpenNow used to be computed against a fixed +05:30 IST offset for every salon regardless
    // of where it actually is — these prove it now resolves each salon's OWN timezone instead.
    describe('isOpenNow (global timezone correctness)', () => {
      const mondayHours = [
        {
          dayOfWeek: 1,
          isClosed: false,
          openTime: '09:00',
          closeTime: '18:00',
        },
      ];

      afterEach(() => {
        jest.useRealTimers();
      });

      async function loadProfile() {
        citiesService.findCityByCountryAndSlugOrThrow.mockResolvedValue({
          id: 'c1',
          slug: 'bengaluru',
          countryCode: 'IN',
        });
        return service.getProfile('IN', 'bengaluru', 'barbercue-demo');
      }

      it('is open for an India salon with no explicit timezone (country fallback to Asia/Kolkata)', async () => {
        // Monday 2026-06-01, 11:00 IST = 05:30 UTC.
        jest.useFakeTimers({ now: new Date('2026-06-01T05:30:00.000Z') });
        prisma.salon.findFirst.mockResolvedValue(
          makeSalon({ operatingHours: mondayHours, services: [], reviews: [] }),
        );
        const profile = await loadProfile();
        expect(profile.isOpenNow).toBe(true);
      });

      it("is open using London's real +01:00 BST offset, at an instant the old fixed +05:30 IST assumption would have wrongly called closed", async () => {
        // 2026-06-01T16:30:00Z: correct London local time is 17:30 (BST, +01:00) — inside
        // 09:00-18:00, so open. The old fixed +05:30 offset would have computed "23:30" for this
        // same UTC instant — outside 09:00-18:00 — and wrongly reported closed.
        jest.useFakeTimers({ now: new Date('2026-06-01T16:30:00.000Z') });
        prisma.salon.findFirst.mockResolvedValue(
          makeSalon({
            city: { slug: 'london', countryCode: 'GB' },
            timezone: 'Europe/London',
            operatingHours: mondayHours,
            services: [],
            reviews: [],
          }),
        );
        const profile = await loadProfile();
        expect(profile.isOpenNow).toBe(true);
      });

      it("is closed using London's real offset, at an instant the old fixed +05:30 IST assumption would have wrongly called open", async () => {
        // 2026-06-01T06:00:00Z: correct London local time is 07:00 (BST) — before this salon's
        // 09:00 open, so closed. The old fixed +05:30 offset would have computed "11:30" for this
        // same UTC instant — inside 09:00-18:00 — and wrongly reported open.
        jest.useFakeTimers({ now: new Date('2026-06-01T06:00:00.000Z') });
        prisma.salon.findFirst.mockResolvedValue(
          makeSalon({
            city: { slug: 'london', countryCode: 'GB' },
            timezone: 'Europe/London',
            operatingHours: mondayHours,
            services: [],
            reviews: [],
          }),
        );
        const profile = await loadProfile();
        expect(profile.isOpenNow).toBe(false);
      });

      it('is null — never falsely Open or Closed — for a non-India salon with no explicit timezone', async () => {
        jest.useFakeTimers({ now: new Date('2026-06-01T05:30:00.000Z') });
        prisma.salon.findFirst.mockResolvedValue(
          makeSalon({
            city: { slug: 'newyork', countryCode: 'US' },
            timezone: null,
            operatingHours: mondayHours,
            services: [],
            reviews: [],
          }),
        );
        const profile = await loadProfile();
        expect(profile.isOpenNow).toBeNull();
      });

      it('is null for an invalid stored IANA timezone string, not a crash', async () => {
        jest.useFakeTimers({ now: new Date('2026-06-01T05:30:00.000Z') });
        prisma.salon.findFirst.mockResolvedValue(
          makeSalon({
            city: { slug: 'newyork', countryCode: 'US' },
            timezone: 'Not/AZone',
            operatingHours: mondayHours,
            services: [],
            reviews: [],
          }),
        );
        const profile = await loadProfile();
        expect(profile.isOpenNow).toBeNull();
      });
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
        service.registerSalon('owner-1', {
          ...input,
          localitySlug: 'no-such-place',
        }),
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
      await expect(service.registerSalon('owner-1', input)).rejects.toBe(
        dbError,
      );
      expect(prisma.salon.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('listOwned', () => {
    it('scopes to salons owned by the given user', async () => {
      prisma.salon.findMany.mockResolvedValue([
        {
          id: 's1',
          publicId: 'BC-SHOP-000001',
          slug: 'a',
          name: 'A',
          status: 'PENDING',
        },
      ]);
      const result = await service.listOwned('owner-1');
      expect(prisma.salon.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerUserId: 'owner-1' } }),
      );
      expect(result).toEqual([
        {
          id: 's1',
          publicId: 'BC-SHOP-000001',
          slug: 'a',
          name: 'A',
          status: 'PENDING',
        },
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
      await expect(service.getOwnedSalon('user-1', 's1')).rejects.toMatchObject(
        {
          code: 'SALON_NOT_FOUND',
        },
      );
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
        {
          role: 'SALON_STAFF',
          salon: salonRow({ id: 'a', name: 'Ace Salon' }),
        },
      ]);
      const result = await service.listWorkplaces('barber-1');
      expect(result.map((r) => r.name)).toEqual(['Ace Salon', 'Zen Cuts']);
    });
  });
});
