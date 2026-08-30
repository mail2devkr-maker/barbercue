import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
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
// pinned explicitly rather than relying on the session-level GUC.
const FUZZY_SIMILARITY_THRESHOLD = 0.3;

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
 * service" field. Same trigram strategy as CitiesService.searchCities (ILIKE containment OR
 * similarity() in the WHERE clause, not just the ORDER BY -- see that file's own comment on why
 * containment alone misses a real typo), backed by the salons_name_trgm_idx/services_name_trgm_idx
 * GIN indexes. Deliberately a read-only suggestion source: choosing a result here doesn't book or
 * navigate anything itself, it just fills in the existing salonSearchQuerySchema.q/.service filter
 * the search page already sends to GET /salons.
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
    const prefixPattern = `${escaped}%`;
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_SUGGEST_LIMIT, 1),
      20,
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
          AND (sa.name ILIKE ${containsPattern} ESCAPE '\\' OR similarity(sa.name, ${rawQuery}) > ${FUZZY_SIMILARITY_THRESHOLD})
        ORDER BY
          (sa.name ILIKE ${prefixPattern} ESCAPE '\\') DESC,
          similarity(sa.name, ${rawQuery}) DESC,
          sa.name ASC
        LIMIT ${limit}
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
          AND (s.name ILIKE ${containsPattern} ESCAPE '\\' OR similarity(s.name, ${rawQuery}) > ${FUZZY_SIMILARITY_THRESHOLD})
        GROUP BY lower(s.name)
        ORDER BY
          bool_or(s.name ILIKE ${prefixPattern} ESCAPE '\\') DESC,
          MAX(similarity(s.name, ${rawQuery})) DESC,
          MIN(s.name) ASC
        LIMIT ${limit}
      `),
    ]);

    const shops: SearchSuggestShopDto[] = shopRows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      citySlug: r.citySlug,
      countryCode: r.countryCode,
    }));
    const services: SearchSuggestServiceDto[] = serviceRows.map((r) => ({
      name: r.name,
      category: r.category,
    }));
    return { shops, services };
  }
}
