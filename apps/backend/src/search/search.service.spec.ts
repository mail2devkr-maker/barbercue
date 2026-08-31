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

    it('queries both shops and services in parallel and maps each ranked result set', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: 's1', name: "Bear's Barbershop", slug: 'bears-barbershop', citySlug: 'bengaluru', countryCode: 'IN' },
        ])
        // "Beard Trim" is a genuine PREFIX match for "bear" ("beard" itself starts with "bear").
        .mockResolvedValueOnce([{ name: 'Beard Trim', category: 'Beard & Shaving' }]);

      const result = await service.suggest({ q: 'bear' });

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        shops: [{ id: 's1', name: "Bear's Barbershop", slug: 'bears-barbershop', citySlug: 'bengaluru', countryCode: 'IN' }],
        services: [{ name: 'Beard Trim', category: 'Beard & Shaving' }],
      });
    });

    it('drops a DB candidate that does not actually classify under exact/prefix/alias/token/fuzzy', async () => {
      // The SQL WHERE is a deliberately wide recall net (Issue 3) -- the pure ranker afterwards is
      // what actually decides whether something counts as a match at all.
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: 's1', name: 'Totally Unrelated Salon Name', slug: 'x', citySlug: 'bengaluru', countryCode: 'IN' },
        ])
        .mockResolvedValueOnce([]);
      const result = await service.suggest({ q: 'bear' });
      expect(result.shops).toEqual([]);
    });

    it('ranks a service candidate reached only via alias resolution correctly (Issue 3 — "bear" -> Beard)', async () => {
      // Mid-string "Beard" so this can only be found via alias resolution, not a literal prefix.
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ name: 'Head Massage with Beard Oil', category: 'Spa / Body Care' }]);
      const result = await service.suggest({ q: 'bear' });
      expect(result.services).toEqual([
        { name: 'Head Massage with Beard Oil', category: 'Spa / Body Care' },
      ]);
    });

    it('orders ranked results exact > prefix > alias > token > fuzzy, not DB row order', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          // Deliberately returned from the "DB" in the WRONG order — the service must re-rank.
          { name: 'Head Massage with Beard Oil', category: null }, // alias
          { name: 'Bear Grooming Co', category: null }, // prefix
          { name: 'bear', category: null }, // exact
        ]);
      const result = await service.suggest({ q: 'bear' });
      expect(result.services.map((s) => s.name)).toEqual([
        'bear',
        'Bear Grooming Co',
        'Head Massage with Beard Oil',
      ]);
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

    it('clamps a limit above the maximum to 20, and truncates the final ranked result to it', async () => {
      // 25 genuine prefix-match rows returned from the "DB" -- the service must still only return
      // 20 after ranking, proving the cap is enforced on the final list, not merely passed to SQL.
      const candidates = Array.from({ length: 25 }, (_, i) => ({
        name: `fade ${i}`,
        category: null,
      }));
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce(candidates);
      const result = await service.suggest({ q: 'fade', limit: 500 });
      expect(result.services.length).toBe(20);
      const [shopSql] = prisma.$queryRaw.mock.calls.map((call) => call[0]);
      // The SQL fetch itself is capped at MAX_CANDIDATE_FETCH (100), never at the raw 500.
      expect(shopSql.values).toContain(100);
      expect(shopSql.values).not.toContain(500);
    });

    it('widens the SQL candidate fetch well beyond the final limit, since ranking happens afterwards', async () => {
      await service.suggest({ q: 'fade' });
      const [shopSql] = prisma.$queryRaw.mock.calls.map((call) => call[0]);
      // Default limit is 5; the candidate fetch multiplies it (5 * 6 = 30) rather than fetching
      // only 5 rows and hoping they happen to already be the best-ranked ones.
      expect(shopSql.values).toContain(30);
    });
  });
});
