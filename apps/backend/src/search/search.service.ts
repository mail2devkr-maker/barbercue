import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  rankSearchCandidates,
  resolveAliasCanonicalTerms,
  type SearchSuggestQueryInput,
  type SearchSuggestResultDto,
  type SearchSuggestServiceDto,
  type SearchSuggestShopDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_SUGGEST_LIMIT = 5;
// Same "still typing, not a real query" convention as CitiesService.searchCities.
const MIN_QUERY_LENGTH = 2;
// pg_trgm's conventional default (see cities.service.ts's own constant for the full rationale) --
// pinned explicitly rather than relying on the session-level GUC. Used here ONLY to widen the SQL
// candidate fetch (recall) -- it is never the tiebreaker for rank order; see the module doc below.
const FUZZY_SIMILARITY_THRESHOLD = 0.3;
// How much wider than the final `limit` the DB candidate fetch casts its net, since the
// authoritative exact/prefix/alias/token/fuzzy classification and ordering happens afterwards, in
// pure TypeScript (packages/shared/src/search/ranking.ts) -- a candidate that ranks outside the
// requested limit once REAL ranking is applied must still have been fetched in the first place.
const CANDIDATE_FETCH_MULTIPLIER = 6;
const MAX_CANDIDATE_FETCH = 100;

interface ShopSuggestRow {
  id: string;
  name: string;
  slug: string;
  citySlug: string;
  countryCode: string;
}

interface ServiceSuggestRow {
  name: string;
  category: string | null;
}

/**
 * GET search/suggest (Issue 3) -- typo-tolerant autosuggest for the search page's "Shop or
 * service" field.
 *
 * Two-phase design, deliberately NOT "let pg_trgm decide": SQL pulls a bounded CANDIDATE set out
 * of a potentially large table using ILIKE containment, alias-term containment, and pg_trgm
 * similarity() as three independent, index-accelerated ways to cast a wide enough net (recall) --
 * then packages/shared/src/search/ranking.ts's classifySearchMatch/rankSearchCandidates decide,
 * in pure TypeScript, the actual required deterministic order (exact > prefix > alias > token >
 * fuzzy) and which candidates actually qualify. pg_trgm's role is reduced to "helps the WHERE
 * clause find rows an index can accelerate"; it is never itself the ranking authority, and the
 * alias/token/exact/prefix tiers exist and are checked regardless of what pg_trgm thinks of a
 * given pair of strings.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async suggest(
    query: SearchSuggestQueryInput,
  ): Promise<SearchSuggestResultDto> {
    const rawQuery = (query.q ?? '').trim();
    if (rawQuery.length < MIN_QUERY_LENGTH) return { shops: [], services: [] };

    const escaped = rawQuery.replace(/[\\%_]/g, '\\$&');
    const containsPattern = `%${escaped}%`;
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_SUGGEST_LIMIT, 1),
      20,
    );
    const candidateLimit = Math.min(
      limit * CANDIDATE_FETCH_MULTIPLIER,
      MAX_CANDIDATE_FETCH,
    );

    // Alias/typo resolution (Issue 3) -- e.g. "bear" -> "beard" -- so a candidate whose name only
    // contains the CANONICAL term is still fetched even though it never contained the literal,
    // misspelled query text. Never mutates any owner-entered name; purely widens what this one
    // read considers a candidate.
    const canonicalTerms = resolveAliasCanonicalTerms(rawQuery);
    const shopAliasConditions = canonicalTerms.map(
      (term) => Prisma.sql`sa.name ILIKE ${`%${term}%`}`,
    );
    const serviceAliasConditions = canonicalTerms.map(
      (term) => Prisma.sql`s.name ILIKE ${`%${term}%`}`,
    );

    const [shopRows, serviceRows] = await Promise.all([
      this.prisma.$queryRaw<ShopSuggestRow[]>(Prisma.sql`
        SELECT
          sa.id,
          sa.name,
          sa.slug,
          c.slug           AS "citySlug",
          c."countryCode"  AS "countryCode"
        FROM salons sa
        JOIN cities c ON c.id = sa."cityId"
        WHERE sa.status = 'ACTIVE'
          AND (
            sa.name ILIKE ${containsPattern} ESCAPE '\\'
            OR similarity(sa.name, ${rawQuery}) > ${FUZZY_SIMILARITY_THRESHOLD}
            ${shopAliasConditions.length > 0 ? Prisma.sql`OR ${Prisma.join(shopAliasConditions, ' OR ')}` : Prisma.empty}
          )
        LIMIT ${candidateLimit}
      `),
      // Grouped by lower(name) -- a suggestion is a service CONCEPT ("Beard Trim"), not one row
      // per salon that happens to offer it, so the same name entered at 500 different salons must
      // collapse into a single suggestion rather than flooding the list with duplicates.
      this.prisma.$queryRaw<ServiceSuggestRow[]>(Prisma.sql`
        SELECT
          MIN(s.name)     AS name,
          MIN(s.category) AS category
        FROM services s
        JOIN salons sa ON sa.id = s."salonId"
        WHERE sa.status = 'ACTIVE'
          AND s."isActive" = true
          AND (
            s.name ILIKE ${containsPattern} ESCAPE '\\'
            OR similarity(s.name, ${rawQuery}) > ${FUZZY_SIMILARITY_THRESHOLD}
            ${serviceAliasConditions.length > 0 ? Prisma.sql`OR ${Prisma.join(serviceAliasConditions, ' OR ')}` : Prisma.empty}
          )
        GROUP BY lower(s.name)
        LIMIT ${candidateLimit}
      `),
    ]);

    const rankedShops = rankSearchCandidates(rawQuery, shopRows, (r) => r.name)
      .slice(0, limit)
      .map(({ candidate }) => candidate);
    const rankedServices = rankSearchCandidates(
      rawQuery,
      serviceRows,
      (r) => r.name,
    )
      .slice(0, limit)
      .map(({ candidate }) => candidate);

    const shops: SearchSuggestShopDto[] = rankedShops.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      citySlug: r.citySlug,
      countryCode: r.countryCode,
    }));
    const services: SearchSuggestServiceDto[] = rankedServices.map((r) => ({
      name: r.name,
      category: r.category,
    }));
    return { shops, services };
  }
}
