import { Test } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SearchService', () => {
  let service: SearchService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const moduleRef = await Test.createTestingModule({
      providers: [SearchService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(SearchService);
  });

  describe('suggest', () => {
    it('returns empty shops/services without querying the database when q is empty', async () => {
      const result = await service.suggest({ q: '' });
      expect(result).toEqual({ shops: [], services: [] });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns empty shops/services when q is shorter than the minimum length', async () => {
      const result = await service.suggest({ q: 'b' });
      expect(result).toEqual({ shops: [], services: [] });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns empty shops/services when q is only whitespace', async () => {
      const result = await service.suggest({ q: '   ' });
      expect(result).toEqual({ shops: [], services: [] });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('queries both shops and services in parallel and maps each result set', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: 's1', name: 'Fresh Cuts', slug: 'fresh-cuts', citySlug: 'bengaluru', countryCode: 'IN' },
        ])
        .mockResolvedValueOnce([{ name: 'Beard Trim', category: 'Beard & Shaving' }]);

      const result = await service.suggest({ q: 'bear' });

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        shops: [{ id: 's1', name: 'Fresh Cuts', slug: 'fresh-cuts', citySlug: 'bengaluru', countryCode: 'IN' }],
        services: [{ name: 'Beard Trim', category: 'Beard & Shaving' }],
      });
    });

    it('includes the trigram similarity clause for both shop and service queries (typo tolerance, not just substring)', async () => {
      await service.suggest({ q: 'bear' });
      const [shopSql, serviceSql] = prisma.$queryRaw.mock.calls.map((call) => call[0]);
      expect(shopSql.sql).toContain('similarity(sa.name');
      expect(shopSql.values).toContain(0.3);
      expect(serviceSql.sql).toContain('similarity(s.name');
      expect(serviceSql.values).toContain(0.3);
    });

    it('only ever queries ACTIVE salons for both shop and service suggestions', async () => {
      await service.suggest({ q: 'fade' });
      const [shopSql, serviceSql] = prisma.$queryRaw.mock.calls.map((call) => call[0]);
      expect(shopSql.sql).toContain("sa.status = 'ACTIVE'");
      expect(serviceSql.sql).toContain("sa.status = 'ACTIVE'");
      expect(serviceSql.sql).toContain('s."isActive" = true');
    });

    it('groups service suggestions by name so one service offered at many salons is a single suggestion', async () => {
      await service.suggest({ q: 'fade' });
      const [, serviceSql] = prisma.$queryRaw.mock.calls.map((call) => call[0]);
      expect(serviceSql.sql).toContain('GROUP BY lower(s.name)');
    });

    it('clamps a limit above the maximum to 20 rather than passing it through unbounded', async () => {
      await service.suggest({ q: 'fade', limit: 500 });
      const [shopSql] = prisma.$queryRaw.mock.calls.map((call) => call[0]);
      expect(shopSql.values).toContain(20);
      expect(shopSql.values).not.toContain(500);
    });

    it('defaults to the standard suggestion size when no limit is given', async () => {
      await service.suggest({ q: 'fade' });
      const [shopSql] = prisma.$queryRaw.mock.calls.map((call) => call[0]);
      expect(shopSql.values).toContain(5);
    });
  });
});
