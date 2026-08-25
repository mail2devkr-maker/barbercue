import { Test } from '@nestjs/testing';
import { CitiesService } from './cities.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

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
    city: { findMany: jest.Mock; findUnique: jest.Mock; findFirst: jest.Mock };
    locality: { findMany: jest.Mock; findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      city: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
      locality: { findMany: jest.fn(), findUnique: jest.fn() },
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
});
