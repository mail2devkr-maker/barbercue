import { Test } from '@nestjs/testing';
import { CountriesService } from './countries.service';
import { PrismaService } from '../prisma/prisma.service';

const india = { id: 'country-in', name: 'India', isoCode2: 'IN', hasSubdivisions: false };
const usa = { id: 'country-us', name: 'United States', isoCode2: 'US', hasSubdivisions: false };

describe('CountriesService', () => {
  let service: CountriesService;
  let prisma: {
    country: { findMany: jest.Mock };
    region: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      country: { findMany: jest.fn() },
      region: { findMany: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [CountriesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CountriesService);
  });

  describe('listCountries', () => {
    it('queries every country sorted by name, with no filter', async () => {
      prisma.country.findMany.mockResolvedValue([india, usa]);
      await service.listCountries();
      expect(prisma.country.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
    });

    it('returns a lean DTO -- id, name, isoCode2, hasSubdivisions only', async () => {
      prisma.country.findMany.mockResolvedValue([india]);
      const result = await service.listCountries();
      expect(result).toEqual([
        { id: 'country-in', name: 'India', isoCode2: 'IN', hasSubdivisions: false },
      ]);
    });

    it('never derives hasSubdivisions -- passes the stored value through unchanged', async () => {
      // Confirms the Phase 4A/6A decision: this field is never computed here, even though every
      // row is currently `false` by the schema default.
      prisma.country.findMany.mockResolvedValue([{ ...india, hasSubdivisions: true }]);
      const result = await service.listCountries();
      expect(result[0].hasSubdivisions).toBe(true);
    });
  });

  describe('listRegions', () => {
    it('returns only regions belonging to the requested country', async () => {
      prisma.region.findMany.mockResolvedValue([
        { id: 'r1', name: 'Karnataka', code: 'IN-KA' },
      ]);
      const result = await service.listRegions('country-in');
      expect(prisma.region.findMany).toHaveBeenCalledWith({
        where: { countryId: 'country-in' },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual([{ id: 'r1', name: 'Karnataka', code: 'IN-KA' }]);
    });

    it('returns [] for a region-less country -- never fabricates a placeholder region', async () => {
      prisma.region.findMany.mockResolvedValue([]);
      const result = await service.listRegions('country-sg');
      expect(result).toEqual([]);
    });

    it('returns [] for a well-formed but nonexistent country id, without a separate existence check', async () => {
      prisma.region.findMany.mockResolvedValue([]);
      const result = await service.listRegions('00000000-0000-0000-0000-000000000000');
      expect(result).toEqual([]);
      expect(prisma.region.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
