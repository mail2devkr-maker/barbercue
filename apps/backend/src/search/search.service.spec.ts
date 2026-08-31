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

    // Independent review (second pass) — the SQL recall phase itself must guarantee two things a
    // bare `LIMIT candidateLimit` cannot: (1) a bounded fetch preferentially retains
    // exact/prefix/alias/token candidates over fuzzy ones, so truncation never arbitrarily drops a
    // strong match while a database has more matching rows than the limit; (2) a genuine
    // token-tier candidate (query words present, but not as one contiguous substring) is recalled
    // at all, rather than depending on pg_trgm happening to cross 0.3. Both properties live in the
    // actual SQL text sent to Postgres — asserted directly below — plus the consumption side (this
    // service must not re-introduce a truncation bug on top of whatever Postgres returns).
    describe('recall guarantees (independent review — SQL ORDER BY + token-wise recall)', () => {
      it('orders the SQL query itself exact > prefix > alias > token > fuzzy, before LIMIT, for both shops and services', async () => {
        await service.suggest({ q: 'bear' });
        const [shopSql, serviceSql] = prisma.$queryRaw.mock.calls.map((call) => call[0]);

        for (const sql of [shopSql.sql, serviceSql.sql]) {
          const orderByIndex = sql.indexOf('ORDER BY');
          const limitIndex = sql.indexOf('LIMIT', orderByIndex);
          expect(orderByIndex).toBeGreaterThan(-1);
          expect(limitIndex).toBeGreaterThan(orderByIndex);

          const exactIndex = sql.indexOf('= lower(', orderByIndex);
          const prefixIndex = sql.indexOf('ILIKE', exactIndex);
          // The alias-priority term and the token-priority term are both built from the same
          // `Prisma.join(...)`-generated OR chains as the WHERE clause's own alias/token
          // conditions, so it's the RELATIVE POSITION within ORDER BY (exact, then prefix, then
          // the next two boolean-priority terms, then similarity) that proves the tier sequence
          // — not distinguishing alias from token by SQL text alone.
          const similarityIndex = sql.indexOf('similarity(', orderByIndex);

          expect(exactIndex).toBeGreaterThan(orderByIndex);
          expect(exactIndex).toBeLessThan(limitIndex);
          expect(prefixIndex).toBeGreaterThan(exactIndex);
          expect(prefixIndex).toBeLessThan(limitIndex);
          expect(similarityIndex).toBeGreaterThan(prefixIndex);
          expect(similarityIndex).toBeLessThan(limitIndex);
        }
      });

      it('includes a parameterized per-token ILIKE condition in the WHERE clause for a multi-word query', async () => {
        await service.suggest({ q: 'beard fade' });
        const [shopSql, serviceSql] = prisma.$queryRaw.mock.calls.map((call) => call[0]);

        for (const sql of [shopSql, serviceSql]) {
          const whereIndex = sql.sql.indexOf('WHERE');
          const orderByIndex = sql.sql.indexOf('ORDER BY');
          const whereClause = sql.sql.slice(whereIndex, orderByIndex);
          // Two separate ILIKE conditions -- one per query word -- not merely the single
          // whole-query containsPattern condition that was already there before this fix.
          expect((whereClause.match(/ILIKE/g) ?? []).length).toBeGreaterThanOrEqual(3);
          expect(sql.values).toContain('%beard%');
          expect(sql.values).toContain('%fade%');
        }
      });

      it('recalls a multi-token candidate whose words appear out of order, where literal full-query containment would not match', async () => {
        // "Fade and Beard Combo" never contains the literal substring "beard fade" -- only the
        // per-token WHERE conditions (added by this fix) would have found it; the whole-query
        // containsPattern/similarity conditions alone could easily miss it.
        prisma.$queryRaw
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ name: 'Fade and Beard Combo', category: null }]);
        const result = await service.suggest({ q: 'beard fade' });
        expect(result.services).toEqual([{ name: 'Fade and Beard Combo', category: null }]);
      });

      it('does not lose the exact match even when the DB returns it last among many genuine fuzzy candidates at the candidateLimit boundary', async () => {
        // Simulates the worst case this fix defends against: candidateLimit (30, for the default
        // limit of 5) worth of rows where the one EXACT match is positioned last, as if an
        // unordered/arbitrarily-ordered scan had returned it that way. Each filler name is a
        // verified genuine FUZZY-tier match for "fade" (typo "faade", score > the 0.3 threshold)
        // -- not merely unrelated junk that the ranker would drop for an unrelated reason -- so
        // this really does exercise "more fuzzy candidates than fit" rather than "noise ignored".
        const fuzzyFiller = Array.from({ length: 29 }, (_, i) => ({
          name: `Faade Studio ${i}`,
          category: null,
        }));
        prisma.$queryRaw
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([...fuzzyFiller, { name: 'fade', category: 'Exact' }]);
        const result = await service.suggest({ q: 'fade' });
        expect(result.services[0]).toEqual({ name: 'fade', category: 'Exact' });
      });

      it('does not lose an alias-only match even when the DB returns it last among many genuine fuzzy candidates at the candidateLimit boundary', async () => {
        // Each filler name is a verified genuine FUZZY-tier match for "bear" (typo "beear").
        const fuzzyFiller = Array.from({ length: 29 }, (_, i) => ({
          name: `Beear Salon ${i}`,
          category: null,
        }));
        prisma.$queryRaw
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            ...fuzzyFiller,
            { name: 'Haircut + Beard', category: 'Alias' }, // "bear" -> "beard" alias, mid-string, never a prefix
          ]);
        const result = await service.suggest({ q: 'bear' });
        // No exact/prefix candidate in this fixture, so alias must rank ahead of every fuzzy one.
        expect(result.services[0]).toEqual({ name: 'Haircut + Beard', category: 'Alias' });
      });

      it('final order across every tier at once: exact > prefix > alias > token > fuzzy', async () => {
        // A single query ("bear") with one verified, unambiguous example of each tier -- see this
        // describe block's own investigation: "bear" (exact), "Bear Grooming Co" (prefix, starts
        // with "bear"), "Haircut + Beard" (alias -- "beard" appears mid-string, never a prefix),
        // "Grylls Bear Barbershop" (token -- "bear" is a later whole word, not the first), "Beear
        // Studio" (fuzzy typo, scores 0.375 -- below every higher tier, above the 0.3 threshold).
        prisma.$queryRaw
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            // Deliberately scrambled DB order -- the service must re-rank into the required order.
            { name: 'Beear Studio', category: null },
            { name: 'Grylls Bear Barbershop', category: null },
            { name: 'Haircut + Beard', category: null },
            { name: 'Bear Grooming Co', category: null },
            { name: 'bear', category: null },
          ]);
        const result = await service.suggest({ q: 'bear' });
        expect(result.services.map((s) => s.name)).toEqual([
          'bear',
          'Bear Grooming Co',
          'Haircut + Beard',
          'Grylls Bear Barbershop',
          'Beear Studio',
        ]);
      });

      // Independent review (fourth pass) — the SQL token-PRIORITY term (ORDER BY) must require
      // ALL query tokens present (AND), not just any one of them (OR). OR is correct for WHERE-
      // clause RECALL (cast a wide net), but wrong for ORDER BY PRIORITY: a row containing only
      // one of several query tokens is not a genuine token-tier match at all (classifySearchMatch
      // requires every token), so giving it the same priority as a true all-tokens match could let
      // a flood of single-token rows crowd the real match out of the bounded candidate set before
      // TypeScript ever sees it.
      describe('AND-based token priority (independent review — round 4)', () => {
        it('builds the SQL token-priority term with AND across per-token conditions, distinct from the OR used for WHERE recall', async () => {
          await service.suggest({ q: 'beard fade' });
          const [shopSql, serviceSql] = prisma.$queryRaw.mock.calls.map((call) => call[0]);

          for (const sql of [shopSql.sql, serviceSql.sql]) {
            const whereIndex = sql.indexOf('WHERE');
            const orderByIndex = sql.indexOf('ORDER BY');
            const whereClause = sql.slice(whereIndex, orderByIndex);
            const orderByClause = sql.slice(orderByIndex);

            // WHERE recall: the per-token conditions are OR'd (cast a wide net). [\s\S]* (not .*)
            // because the generated SQL is a real multi-line string and `.` never matches a
            // newline in JS regex without the dotAll flag.
            expect(whereClause).toMatch(/ILIKE[\s\S]*ESCAPE '\\' OR [\s\S]*ILIKE[\s\S]*ESCAPE '\\'/);
            expect(whereClause).not.toMatch(/ILIKE[\s\S]*ESCAPE '\\' AND [\s\S]*ILIKE[\s\S]*ESCAPE '\\'/);
            // ORDER BY priority: the SAME shape of per-token conditions, but AND'd together —
            // proven by finding an "ILIKE ... AND ... ILIKE" sequence within the ORDER BY clause
            // specifically (not merely present anywhere in the whole query text).
            expect(orderByClause).toMatch(/ILIKE[\s\S]*ESCAPE '\\' AND [\s\S]*ILIKE[\s\S]*ESCAPE '\\'/);
            expect(orderByClause).not.toMatch(/ILIKE[\s\S]*ESCAPE '\\' OR [\s\S]*ILIKE[\s\S]*ESCAPE '\\'/);
          }
        });

        it('derives SQL tokens via the same normalizeForMatch semantics as the TypeScript matcher, so hyphenation/punctuation agree', async () => {
          await service.suggest({ q: 'hair-cut' });
          const [shopSql] = prisma.$queryRaw.mock.calls.map((call) => call[0]);
          // normalizeForMatch("hair-cut") -> "hair cut" -> tokens ["hair", "cut"] -- a naive
          // whitespace-only split (a hyphen has no whitespace either side) would never have
          // separated it into two tokens at all, so these two SEPARATE token patterns proves
          // normalizeForMatch, not `.split(/\s+/)`, is what derives them. (`%hair-cut%` also
          // legitimately appears among the values too -- that's the unrelated, unnormalized
          // whole-query containsPattern/prefixPattern, out of this fix's scope and unchanged.)
          expect(shopSql.values).toContain('%hair%');
          expect(shopSql.values).toContain('%cut%');
        });

        it('boundary regression: a genuine all-tokens candidate survives and outranks candidateLimit-worth of single-token-only rows', async () => {
          // 29 filler rows, each containing only ONE of the two query tokens ("beard" xor "fade")
          // -- verified genuine FUZZY-tier matches (classifySearchMatch requires ALL tokens for
          // the token tier, so a single-token row can never itself be token-tier) -- plus one
          // genuine ALL-tokens candidate ("Fade and Beard Combo", scrambled word order) placed
          // LAST, as if an unordered scan had returned it that way. With the OLD OR-based SQL
          // priority this genuine match would have received no more priority than any of the 29
          // weaker rows and could have been the one arbitrarily dropped by LIMIT in real Postgres;
          // the AND-based priority (this fix) is what guarantees Postgres itself would rank it
          // ahead of every single-token row before truncating. This test proves the CONSUMPTION
          // side: even handed the worst-case row order, the service's own ranking still surfaces
          // and correctly tiers it above every fuzzy filler.
          const singleTokenFiller = Array.from({ length: 29 }, (_, i) =>
            i % 2 === 0
              ? { name: `Beard Studio ${i}`, category: null } // "beard" only
              : { name: `Fade Studio ${i}`, category: null }, // "fade" only
          );
          prisma.$queryRaw
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
              ...singleTokenFiller,
              { name: 'Fade and Beard Combo', category: 'Token' },
            ]);
          const result = await service.suggest({ q: 'beard fade' });
          expect(result.services[0]).toEqual({ name: 'Fade and Beard Combo', category: 'Token' });
        });

        it('final TypeScript ordering within this same multi-token scenario still holds exact > prefix > token > fuzzy', async () => {
          // Verified fixture set for query "beard fade": exact, prefix, a scrambled-order token
          // match, and a single-token-only fuzzy filler -- no alias tier exists for this specific
          // two-word query (resolveAliasCanonicalTerms only matches a whole registered phrase, and
          // "beard fade" isn't one; alias-tier ordering is separately proven, for a query that DOES
          // have one, by the single-tier-per-query "bear" test above).
          prisma.$queryRaw
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
              // Deliberately scrambled DB order -- the service must re-rank into the required order.
              { name: 'Beard Studio 0', category: null }, // fuzzy (single-token-only)
              { name: 'Fade and Beard Combo', category: null }, // token (scrambled word order)
              { name: 'Beard Fade Specialists', category: null }, // prefix
              { name: 'Beard Fade', category: null }, // exact
            ]);
          const result = await service.suggest({ q: 'beard fade' });
          expect(result.services.map((s) => s.name)).toEqual([
            'Beard Fade',
            'Beard Fade Specialists',
            'Fade and Beard Combo',
            'Beard Studio 0',
          ]);
        });
      });
    });
  });
});
