import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CitiesService } from './cities.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const bengaluru = {
  id: 'c1',
  name: 'Bengaluru',
  slug: 'bengaluru',
  countryCode: 'IN',
  regionCode: null,
  state: 'Karnataka',
  country: 'India',
};

describe('CitiesService', () => {
  let service: CitiesService;
  let prisma: {
    city: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
    };
    locality: { findMany: jest.Mock; findUnique: jest.Mock };
    country: { findUnique: jest.Mock };
    region: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      city: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      locality: { findMany: jest.fn(), findUnique: jest.fn() },
      country: { findUnique: jest.fn() },
      region: { findUnique: jest.fn() },
      $queryRaw: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [CitiesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CitiesService);
  });

  // Registration's city list must NOT inherit listCities' ACTIVE-salon filter: a city only gets
  // an ACTIVE salon after one is registered there, so filtering would make the first shop in any
  // city impossible to register — the deadlock this method exists to break.
  describe('listAllCities', () => {
    it('queries every city with no ACTIVE-salon filter', async () => {
      prisma.city.findMany.mockResolvedValue([]);

      await service.listAllCities();

      expect(prisma.city.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
      const [args] = prisma.city.findMany.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(args.where).toBeUndefined();
    });

    it('returns a city that has no salons at all', async () => {
      prisma.city.findMany.mockResolvedValue([bengaluru]);
      await expect(service.listAllCities()).resolves.toEqual([bengaluru]);
    });
  });

  describe('listCities', () => {
    it('only queries cities that have at least one ACTIVE salon', async () => {
      prisma.city.findMany.mockResolvedValue([bengaluru]);
      const result = await service.listCities();
      expect(prisma.city.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { salons: { some: { status: 'ACTIVE' } } },
        }),
      );
      expect(result).toEqual([bengaluru]);
    });
  });

  // B9: every public discovery read resolves through this exact (countryCode, slug) lookup, so a
  // same-named city in a different country can never be returned by mistake.
  describe('findCityByCountryAndSlugOrThrow', () => {
    it('looks up by the exact composite key, uppercasing the country code', async () => {
      prisma.city.findUnique.mockResolvedValue(bengaluru);

      await service.findCityByCountryAndSlugOrThrow('in', 'bengaluru');

      expect(prisma.city.findUnique).toHaveBeenCalledWith({
        where: { countryCode_slug: { countryCode: 'IN', slug: 'bengaluru' } },
      });
    });

    it('is case-insensitive about the country code segment (public URLs are lowercase)', async () => {
      prisma.city.findUnique.mockResolvedValue(bengaluru);
      await expect(
        service.findCityByCountryAndSlugOrThrow('IN', 'bengaluru'),
      ).resolves.toMatchObject({ id: 'c1' });
      await expect(
        service.findCityByCountryAndSlugOrThrow('in', 'bengaluru'),
      ).resolves.toMatchObject({ id: 'c1' });
    });

    it('throws CITY_NOT_FOUND when no city exists for that exact country', async () => {
      prisma.city.findUnique.mockResolvedValue(null);
      await expect(
        service.findCityByCountryAndSlugOrThrow('GB', 'bengaluru'),
      ).rejects.toMatchObject({ code: 'CITY_NOT_FOUND' });
    });
  });

  describe('getCity', () => {
    it('throws CITY_NOT_FOUND for an unknown (country, slug) pair', async () => {
      prisma.city.findUnique.mockResolvedValue(null);
      await expect(service.getCity('IN', 'nowhere')).rejects.toMatchObject({
        code: 'CITY_NOT_FOUND',
      });
    });

    it('returns the mapped CityDto when found', async () => {
      prisma.city.findUnique.mockResolvedValue(bengaluru);
      await expect(service.getCity('IN', 'bengaluru')).resolves.toEqual(
        bengaluru,
      );
    });
  });

  describe('listLocalities', () => {
    it('resolves the city via the country-scoped lookup before listing localities', async () => {
      prisma.city.findUnique.mockResolvedValue(bengaluru);
      prisma.locality.findMany.mockResolvedValue([]);

      await service.listLocalities('IN', 'bengaluru');

      expect(prisma.city.findUnique).toHaveBeenCalledWith({
        where: { countryCode_slug: { countryCode: 'IN', slug: 'bengaluru' } },
      });
      expect(prisma.locality.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ cityId: 'c1' }) }),
      );
    });
  });

  // The slug-only lookup is kept solely for SalonsService.registerSalon, which independently
  // verifies country against the resolved city — it must remain exactly as deployed in B4-B8.
  describe('findCityBySlugOrThrow (registration-only, deliberately not country-scoped)', () => {
    it('throws CITY_NOT_FOUND for an unknown slug', async () => {
      prisma.city.findFirst.mockResolvedValue(null);
      await expect(
        service.findCityBySlugOrThrow('nowhere'),
      ).rejects.toMatchObject({ code: 'CITY_NOT_FOUND' });
    });

    it('returns the city row when found', async () => {
      prisma.city.findFirst.mockResolvedValue({ id: 'c1', slug: 'bengaluru' });
      await expect(
        service.findCityBySlugOrThrow('bengaluru'),
      ).resolves.toMatchObject({ id: 'c1' });
    });
  });

  describe('getLocality', () => {
    it('throws LOCALITY_NOT_FOUND when the locality does not exist in that city', async () => {
      prisma.city.findUnique.mockResolvedValue(bengaluru);
      prisma.locality.findUnique.mockResolvedValue(null);
      await expect(
        service.getLocality('IN', 'bengaluru', 'nowhere'),
      ).rejects.toBeInstanceOf(AppException);
    });

    it('throws CITY_NOT_FOUND when the city itself does not exist for that country', async () => {
      prisma.city.findUnique.mockResolvedValue(null);
      await expect(
        service.getLocality('GB', 'bengaluru', 'indiranagar'),
      ).rejects.toMatchObject({ code: 'CITY_NOT_FOUND' });
      expect(prisma.locality.findUnique).not.toHaveBeenCalled();
    });
  });

  // Phase 6A: the scalable city-search endpoint the ~99,797-row imported dataset requires.
  describe('searchCities', () => {
    const bengaluruRow = {
      id: 'c1',
      name: 'Bengaluru',
      slug: 'bengaluru',
      countryCode: 'IN',
      countryName: 'India',
      regionId: 'r1',
      regionName: 'Karnataka',
      regionCode: 'IN-KA',
    };

    it('returns [] without querying the database when q is empty', async () => {
      const result = await service.searchCities({ countryId: 'country-1', q: '' });
      expect(result).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns [] without querying the database when q is shorter than the minimum length', async () => {
      const result = await service.searchCities({ countryId: 'country-1', q: 'b' });
      expect(result).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns [] without querying the database when q is only whitespace', async () => {
      const result = await service.searchCities({ countryId: 'country-1', q: '   ' });
      expect(result).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('queries with the country filter and maps a lean result including its region', async () => {
      prisma.$queryRaw.mockResolvedValue([bengaluruRow]);
      const result = await service.searchCities({ countryId: 'country-1', q: 'ben' });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const sqlFragment = prisma.$queryRaw.mock.calls[0][0];
      expect(sqlFragment.values).toContain('country-1');
      expect(result).toEqual([
        {
          id: 'c1',
          name: 'Bengaluru',
          slug: 'bengaluru',
          countryCode: 'IN',
          countryName: 'India',
          region: { id: 'r1', name: 'Karnataka', code: 'IN-KA' },
        },
      ]);
    });

    // Issue 10 — the search page's city field has no country pre-selected.
    it('omits the countryId filter entirely when none is given (global search-page mode)', async () => {
      prisma.$queryRaw.mockResolvedValue([bengaluruRow]);
      await service.searchCities({ q: 'ben' });
      const sqlFragment = prisma.$queryRaw.mock.calls[0][0];
      expect(sqlFragment.sql).not.toContain('"countryId"');
    });

    // Issue 10 — plain ILIKE containment alone cannot find a real typo (a transposed/missing
    // letter breaks substring matching); the trigram OR clause is what makes this "typo-tolerant"
    // rather than merely "prefix/substring tolerant".
    it('includes the trigram similarity clause so a genuine typo (not just a substring) can still match', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.searchCities({ q: 'bengalore' });
      const sqlFragment = prisma.$queryRaw.mock.calls[0][0];
      expect(sqlFragment.sql).toContain('similarity(c.name');
      expect(sqlFragment.values).toContain(0.3);
    });

    it('includes the region filter in the query parameters when regionId is provided', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.searchCities({ countryId: 'country-1', regionId: 'region-1', q: 'mum' });
      const sqlFragment = prisma.$queryRaw.mock.calls[0][0];
      expect(sqlFragment.values).toContain('country-1');
      expect(sqlFragment.values).toContain('region-1');
    });

    it('maps a city with no region to region: null', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { ...bengaluruRow, regionId: null, regionName: null, regionCode: null },
      ]);
      const result = await service.searchCities({ countryId: 'country-1', q: 'ben' });
      expect(result[0].region).toBeNull();
    });

    it('clamps a limit above the maximum to 50 rather than passing it through unbounded', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      // Simulates a caller bypassing the schema's own max(50) validation (e.g. a direct service
      // call) -- the service itself must clamp defensively too.
      await service.searchCities({ countryId: 'country-1', q: 'ben', limit: 5000 });
      const sqlFragment = prisma.$queryRaw.mock.calls[0][0];
      expect(sqlFragment.values).toContain(50);
      expect(sqlFragment.values).not.toContain(5000);
    });

    it('defaults to the standard page size when no limit is given', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.searchCities({ countryId: 'country-1', q: 'ben' });
      const sqlFragment = prisma.$queryRaw.mock.calls[0][0];
      expect(sqlFragment.values).toContain(20);
    });
  });

  // Issue 7's "Use as entered" fallback: registration must not dead-end when an owner's real city
  // is missing from the imported master list.
  describe('createOwnerSubmittedCity', () => {
    const india = { id: 'country-1', isoCode2: 'IN', name: 'India' };
    const karnataka = { id: 'region-1', countryId: 'country-1', name: 'Karnataka', code: 'IN-KA' };

    it('throws COUNTRY_NOT_FOUND for an unknown countryId', async () => {
      prisma.country.findUnique.mockResolvedValue(null);
      await expect(
        service.createOwnerSubmittedCity({ name: 'Mysuru', countryId: 'nope' }),
      ).rejects.toMatchObject({ code: 'COUNTRY_NOT_FOUND' });
      expect(prisma.city.create).not.toHaveBeenCalled();
    });

    it('throws REGION_NOT_FOUND when the region belongs to a different country', async () => {
      prisma.country.findUnique.mockResolvedValue(india);
      prisma.region.findUnique.mockResolvedValue({ ...karnataka, countryId: 'other-country' });
      await expect(
        service.createOwnerSubmittedCity({
          name: 'Mysuru',
          countryId: 'country-1',
          regionId: 'region-1',
        }),
      ).rejects.toMatchObject({ code: 'REGION_NOT_FOUND' });
      expect(prisma.city.create).not.toHaveBeenCalled();
    });

    it('creates a new City scoped to the chosen country/region, marked owner-submitted', async () => {
      prisma.country.findUnique.mockResolvedValue(india);
      prisma.region.findUnique.mockResolvedValue(karnataka);
      prisma.city.findUnique.mockResolvedValue(null); // no existing slug collision
      prisma.city.create.mockResolvedValue({
        id: 'new-city',
        name: 'Mysuru',
        slug: 'mysuru',
        countryCode: 'IN',
      });

      const result = await service.createOwnerSubmittedCity({
        name: 'Mysuru',
        countryId: 'country-1',
        regionId: 'region-1',
      });

      expect(prisma.city.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Mysuru',
          slug: 'mysuru',
          countryCode: 'IN',
          regionCode: 'IN-KA',
          state: 'Karnataka',
          country: 'India',
          countryId: 'country-1',
          regionId: 'region-1',
          sourceDataset: 'owner-submitted',
        }),
      });
      expect(result).toEqual({
        id: 'new-city',
        name: 'Mysuru',
        slug: 'mysuru',
        countryCode: 'IN',
        region: { id: 'region-1', name: 'Karnataka', code: 'IN-KA' },
      });
    });

    it('creates with an empty state and no region fields when no region is chosen', async () => {
      prisma.country.findUnique.mockResolvedValue(india);
      prisma.city.findUnique.mockResolvedValue(null);
      prisma.city.create.mockResolvedValue({
        id: 'new-city',
        name: 'Mysuru',
        slug: 'mysuru',
        countryCode: 'IN',
      });

      const result = await service.createOwnerSubmittedCity({
        name: 'Mysuru',
        countryId: 'country-1',
      });

      expect(prisma.city.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ state: '', regionCode: null, regionId: null }),
      });
      expect(result.region).toBeNull();
      expect(prisma.region.findUnique).not.toHaveBeenCalled();
    });

    it('reuses an existing City rather than duplicating when the same name already resolves to this slug', async () => {
      prisma.country.findUnique.mockResolvedValue(india);
      prisma.city.findUnique.mockResolvedValue({
        id: 'existing-city',
        name: 'Mysuru',
        slug: 'mysuru',
        countryCode: 'IN',
      });

      const result = await service.createOwnerSubmittedCity({
        name: 'mysuru', // different casing — still the same city
        countryId: 'country-1',
      });

      expect(prisma.city.create).not.toHaveBeenCalled();
      expect(result.id).toBe('existing-city');
    });

    it('retries with a numeric-suffixed slug when a DIFFERENT city already owns the base slug', async () => {
      prisma.country.findUnique.mockResolvedValue(india);
      // The existing row at this slug has a different name, so it is not a reuse candidate — a
      // genuine two-different-cities-same-slug collision.
      prisma.city.findUnique.mockResolvedValue({
        id: 'other-city',
        name: 'Some Other Place',
        slug: 'mysuru',
        countryCode: 'IN',
      });
      prisma.city.create
        .mockRejectedValueOnce(uniqueViolation())
        .mockResolvedValueOnce({ id: 'new-city', name: 'Mysuru', slug: 'mysuru-2', countryCode: 'IN' });

      const result = await service.createOwnerSubmittedCity({
        name: 'Mysuru',
        countryId: 'country-1',
      });

      expect(prisma.city.create).toHaveBeenCalledTimes(2);
      expect(prisma.city.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({ slug: 'mysuru' }),
      });
      expect(prisma.city.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({ slug: 'mysuru-2' }),
      });
      expect(result.slug).toBe('mysuru-2');
    });

    it('propagates a non-collision error from city.create unchanged', async () => {
      prisma.country.findUnique.mockResolvedValue(india);
      prisma.city.findUnique.mockResolvedValue(null);
      prisma.city.create.mockRejectedValue(new Error('db is down'));

      await expect(
        service.createOwnerSubmittedCity({ name: 'Mysuru', countryId: 'country-1' }),
      ).rejects.toThrow('db is down');
    });
  });
});
