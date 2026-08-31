import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  normalizeForMatch,
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

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * GET search/suggest (Issue 3) -- typo-tolerant autosuggest for the search page's "Shop or
 * service" field.
 *
 * Two-phase design, deliberately NOT "let pg_trgm decide": SQL pulls a bounded CANDIDATE set out
 * of a potentially large table using ILIKE containment (whole-query AND per-token -- see below),
 * alias-term containment, and pg_trgm similarity() as independent, index-accelerated ways to cast
 * a wide enough net (recall) -- then packages/shared/src/search/ranking.ts's
 * classifySearchMatch/rankSearchCandidates decide, in pure TypeScript, the actual required
 * deterministic order (exact > prefix > alias > token > fuzzy) and which candidates actually
 * qualify. pg_trgm's role is reduced to "helps the WHERE clause find rows an index can
 * accelerate"; it is never itself the ranking authority, and the alias/token/exact/prefix tiers
 * exist and are checked regardless of what pg_trgm thinks of a given pair of strings.
 *
 * Correctness properties the recall SQL itself must guarantee (independent-review fixes, most
 * recent round first):
 *
 * 0. The SQL token-PRIORITY term (used in ORDER BY, to decide what survives a bounded LIMIT) must
 *    require ALL query tokens present (AND), not just ANY one of them (OR) -- OR is the right
 *    shape for WHERE-clause RECALL (cast a wide net) but the wrong shape for ORDER BY PRIORITY: a
 *    row containing only one of several query tokens is not a genuine token-tier match at all
 *    (classifySearchMatch requires every token), so prioritizing it the same as a row containing
 *    every token could let a flood of one-token-only rows crowd a true multi-token match out of
 *    the bounded candidate set before TypeScript ever sees it. Recall (WHERE) and priority (ORDER
 *    BY) are therefore built from the SAME per-token conditions but combined differently: OR for
 *    recall, AND for priority. Token derivation also goes through the shared normalizeForMatch()
 *    -- the exact function classifySearchMatch itself tokenizes with -- so a hyphenated/punctuated
 *    query ("hair-cut") splits into SQL tokens identically to how TypeScript will later tokenize
 *    it, rather than SQL's naive whitespace-only split disagreeing with what actually gets ranked.
 * 1. Bounded recall must not silently drop a strong candidate. `LIMIT candidateLimit` alone gives
 *    Postgres no ordering guarantee -- with more matching rows than the limit, an arbitrary subset
 *    could survive, including one made entirely of weak fuzzy matches while a genuine exact/
 *    prefix/alias/token candidate is dropped before the TypeScript ranker ever sees it. Every
 *    query below carries an ORDER BY that mirrors the tier priority (exact-ish > prefix > alias >
 *    all-tokens > fuzzy similarity) BEFORE the LIMIT is applied, so truncation always sheds the
 *    weakest (fuzzy, or partial-token) candidates first. This ORDER BY is a cheap, index-blind
 *    heuristic over an already-index-filtered row set -- it does not need to (and cannot cheaply)
 *    reproduce classifySearchMatch's exact normalization; TypeScript remains the sole authority on
 *    the FINAL order returned to the caller.
 * 2. A multi-word query's TOKEN-tier candidates (e.g. "beard fade" matching "Fade and Beard
 *    combo", where the words appear out of order / with other text between them, so the literal
 *    "beard fade" substring never appears) must not depend on pg_trgm happening to cross the
 *    fuzzy threshold. Each individual query word gets its own parameterized ILIKE containment
 *    condition, OR'd into the WHERE -- a strict superset of "every token present" (what the
 *    TypeScript token tier actually requires), so nothing the token tier could match is ever
 *    excluded from recall.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async suggest(
    query: SearchSuggestQueryInput,
  ): Promise<SearchSuggestResultDto> {
    const rawQuery = (query.q ?? '').trim();
    if (rawQuery.length < MIN_QUERY_LENGTH) return { shops: [], services: [] };

    const containsPattern = `%${escapeIlike(rawQuery)}%`;
    const prefixPattern = `${escapeIlike(rawQuery)}%`;
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_SUGGEST_LIMIT, 1),
      20,
    );
    const candidateLimit = Math.min(
      limit * CANDIDATE_FETCH_MULTIPLIER,
      MAX_CANDIDATE_FETCH,
    );

    // Individual query words, derived through the SAME normalizeForMatch() classifySearchMatch
    // itself tokenizes with -- e.g. "beard fade" -> ["beard", "fade"], "hair-cut" -> ["hair",
    // "cut"] -- so SQL recall/priority can never disagree with TypeScript about what a query's
    // "tokens" are. A single-word query yields exactly one token (redundant with the whole-query
    // patterns above, but harmless). Punctuation-only input normalizes to '' and yields zero
    // tokens -- every token-derived condition below degrades gracefully to "not applicable" rather
    // than calling Prisma.join([]), which throws on an empty array.
    const queryTokens = normalizeForMatch(rawQuery)
      .split(' ')
      .filter((token) => token.length > 0)
      .map(escapeIlike);

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
    const shopTokenConditions = queryTokens.map(
      (token) => Prisma.sql`sa.name ILIKE ${`%${token}%`} ESCAPE '\\'`,
    );
    const serviceTokenConditions = queryTokens.map(
      (token) => Prisma.sql`s.name ILIKE ${`%${token}%`} ESCAPE '\\'`,
    );
    // Reused in both the WHERE (as an extra OR branch, when non-empty) and the ORDER BY (as a
    // priority tier). The "no canonical term for this query" fallback is `(1 = 0)`, NOT a bare
    // `false` literal -- verified empirically against real Postgres: a bare (even parenthesized)
    // boolean CONSTANT in an ORDER BY position is ambiguous with the SQL ordinal-position shortcut
    // (`ORDER BY 1, 2`) and Postgres rejects it outright ("non-integer constant in ORDER BY"); a
    // genuine boolean-valued EXPRESSION like `1 = 0` has no such ambiguity and always evaluates to
    // false the same way.
    const shopAliasPriority =
      shopAliasConditions.length > 0
        ? Prisma.sql`(${Prisma.join(shopAliasConditions, ' OR ')})`
        : Prisma.sql`(1 = 0)`;
    const serviceAliasPriority =
      serviceAliasConditions.length > 0
        ? Prisma.sql`(${Prisma.join(serviceAliasConditions, ' OR ')})`
        : Prisma.sql`(1 = 0)`;
    // ALL-tokens-present priority (AND) -- deliberately DIFFERENT from the per-token RECALL
    // conditions above, which are OR'd into the WHERE for broad recall. A row containing only some
    // query tokens is not a token-tier match (classifySearchMatch requires every token), so it
    // must not receive the same ORDER BY priority as a row containing all of them -- see this
    // class's own doc comment, point 0.
    const shopAllTokensPriority =
      shopTokenConditions.length > 0
        ? Prisma.sql`(${Prisma.join(shopTokenConditions, ' AND ')})`
        : Prisma.sql`(1 = 0)`;
    const serviceAllTokensPriority =
      serviceTokenConditions.length > 0
        ? Prisma.sql`(${Prisma.join(serviceTokenConditions, ' AND ')})`
        : Prisma.sql`(1 = 0)`;

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
            ${shopTokenConditions.length > 0 ? Prisma.sql`OR ${Prisma.join(shopTokenConditions, ' OR ')}` : Prisma.empty}
          )
        ORDER BY
          (lower(sa.name) = lower(${rawQuery})) DESC,
          (sa.name ILIKE ${prefixPattern} ESCAPE '\\') DESC,
          ${shopAliasPriority} DESC,
          ${shopAllTokensPriority} DESC,
          similarity(sa.name, ${rawQuery}) DESC,
          sa.name ASC
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
            ${serviceTokenConditions.length > 0 ? Prisma.sql`OR ${Prisma.join(serviceTokenConditions, ' OR ')}` : Prisma.empty}
          )
        GROUP BY lower(s.name)
        ORDER BY
          bool_or(lower(s.name) = lower(${rawQuery})) DESC,
          bool_or(s.name ILIKE ${prefixPattern} ESCAPE '\\') DESC,
          bool_or(${serviceAliasPriority}) DESC,
          bool_or(${serviceAllTokensPriority}) DESC,
          MAX(similarity(s.name, ${rawQuery})) DESC,
          MIN(s.name) ASC
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
