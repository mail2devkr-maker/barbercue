import { Test } from '@nestjs/testing';
import { CitiesService } from './cities.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

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
      prisma.city.findMany.mockResolvedValue([
        {
          id: 'c1',
          name: 'Bengaluru',
          slug: 'bengaluru',
          countryCode: 'IN',
          regionCode: null,
          state: 'Karnataka',
          country: 'India',
        },
      ]);

      await expect(service.listAllCities()).resolves.toEqual([
        {
          id: 'c1',
          name: 'Bengaluru',
          slug: 'bengaluru',
          countryCode: 'IN',
          regionCode: null,
          state: 'Karnataka',
          country: 'India',
        },
      ]);
    });
  });

  describe('listCities', () => {
    it('only queries cities that have at least one ACTIVE salon', async () => {
      prisma.city.findMany.mockResolvedValue([
        {
          id: 'c1',
          name: 'Bengaluru',
          slug: 'bengaluru',
          countryCode: 'IN',
          regionCode: null,
          state: 'Karnataka',
          country: 'India',
        },
      ]);
      const result = await service.listCities();
      expect(prisma.city.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { salons: { some: { status: 'ACTIVE' } } },
        }),
      );
      expect(result).toEqual([
        {
          id: 'c1',
          name: 'Bengaluru',
          slug: 'bengaluru',
          countryCode: 'IN',
          regionCode: null,
          state: 'Karnataka',
          country: 'India',
        },
      ]);
    });
  });

  describe('getCity', () => {
    it('throws CITY_NOT_FOUND for an unknown slug', async () => {
      prisma.city.findFirst.mockResolvedValue(null);
      await expect(service.getCity('nowhere')).rejects.toMatchObject({
        code: 'CITY_NOT_FOUND',
      });
    });

    it('returns the mapped CityDto when found', async () => {
      prisma.city.findFirst.mockResolvedValue({
        id: 'c1',
        name: 'Bengaluru',
        slug: 'bengaluru',
        countryCode: 'IN',
        regionCode: null,
        state: 'Karnataka',
        country: 'India',
      });
      await expect(service.getCity('bengaluru')).resolves.toEqual({
        id: 'c1',
        name: 'Bengaluru',
        slug: 'bengaluru',
        countryCode: 'IN',
        regionCode: null,
        state: 'Karnataka',
        country: 'India',
      });
    });
  });

  describe('findCityBySlugOrThrow', () => {
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
      prisma.city.findFirst.mockResolvedValue({ id: 'c1', slug: 'bengaluru' });
      prisma.locality.findUnique.mockResolvedValue(null);
      await expect(
        service.getLocality('bengaluru', 'nowhere'),
      ).rejects.toBeInstanceOf(AppException);
    });
  });
});
