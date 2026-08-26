import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SalonStatus,
  type CityDto,
  type CitySearchQueryInput,
  type CitySearchResultDto,
  type LocalityDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

const DEFAULT_SEARCH_LIMIT = 20;
// City name/query strings shorter than this never reach the database — an empty or 1-character
// `q` is a normal "still typing" state in a live-search UI, not something worth a ~100K-row
// trigram scan for. See the Phase 5 investigation report's search design.
const MIN_SEARCH_QUERY_LENGTH = 2;

interface CitySearchRow {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  regionId: string | null;
  regionName: string | null;
  regionCode: string | null;
}

@Injectable()
export class CitiesService {
  constructor(private readonly prisma: PrismaService) {}

  // Only cities/localities with at least one ACTIVE salon are surfaced — no dead-end pages
  // linking to a city with nothing bookable in it.
  async listCities(): Promise<CityDto[]> {
    const cities = await this.prisma.city.findMany({
      where: { salons: { some: { status: SalonStatus.ACTIVE } } },
      orderBy: { name: 'asc' },
    });
    return cities.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      countryCode: c.countryCode,
      regionCode: c.regionCode,
      state: c.state,
      country: c.country,
    }));
  }

  /**
   * Every city, unfiltered — the list a shop owner picks from when registering.
   *
   * Deliberately NOT listCities() above: that one hides cities with no ACTIVE salon, which is
   * right for public discovery but creates a deadlock for registration. The first shop in a city
   * can only become ACTIVE after it is registered, and it can only be registered if its city is
   * selectable — so a filtered list would make every new city permanently unreachable.
   */
  async listAllCities(): Promise<CityDto[]> {
    const cities = await this.prisma.city.findMany({
      orderBy: { name: 'asc' },
    });
    return cities.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      countryCode: c.countryCode,
      regionCode: c.regionCode,
      state: c.state,
      country: c.country,
    }));
  }

  /**
   * GET cities/:countryCode/:citySlug — the country-scoped public lookup (B9). Every discovery
   * route below resolves through findCityByCountryAndSlugOrThrow, an exact findUnique on the
   * (countryCode, slug) composite key, so "London GB" and "London CA" can never be confused with
   * each other regardless of lookup order.
   */
  async getCity(countryCode: string, citySlug: string): Promise<CityDto> {
    const city = await this.findCityByCountryAndSlugOrThrow(
      countryCode,
      citySlug,
    );
    return {
      id: city.id,
      name: city.name,
      slug: city.slug,
      countryCode: city.countryCode,
      regionCode: city.regionCode,
      state: city.state,
      country: city.country,
    };
  }

  async listLocalities(
    countryCode: string,
    citySlug: string,
  ): Promise<LocalityDto[]> {
    const city = await this.findCityByCountryAndSlugOrThrow(
      countryCode,
      citySlug,
    );
    const localities = await this.prisma.locality.findMany({
      where: {
        cityId: city.id,
        salons: { some: { status: SalonStatus.ACTIVE } },
      },
      orderBy: { name: 'asc' },
    });
    return localities.map((l) => ({
      id: l.id,
      name: l.name,
      slug: l.slug,
      citySlug: city.slug,
    }));
  }

  async getLocality(
    countryCode: string,
    citySlug: string,
    localitySlug: string,
  ): Promise<LocalityDto> {
    const city = await this.findCityByCountryAndSlugOrThrow(
      countryCode,
      citySlug,
    );
    const locality = await this.prisma.locality.findUnique({
      where: { cityId_slug: { cityId: city.id, slug: localitySlug } },
    });
    if (!locality) {
      throw new AppException(
        'LOCALITY_NOT_FOUND',
        'Locality not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      id: locality.id,
      name: locality.name,
      slug: locality.slug,
      citySlug: city.slug,
    };
  }

  /**
   * Country-scoped, unambiguous city lookup (B9's "final" replacement for the interim
   * findFirst({ slug }) this method used to be). Uses the exact (countryCode, slug) composite
   * unique index added in the country-code migration, so this is a real findUnique, not a guess
   * at which same-named city across countries the caller meant.
   *
   * `countryCode` is uppercased before the lookup so public URLs can use a friendlier lowercase
   * segment (/in/bengaluru/...) while City.countryCode is stored uppercase (ISO-3166-1 alpha-2).
   */
  async findCityByCountryAndSlugOrThrow(countryCode: string, citySlug: string) {
    const city = await this.prisma.city.findUnique({
      where: {
        countryCode_slug: {
          countryCode: countryCode.toUpperCase(),
          slug: citySlug,
        },
      },
    });
    if (!city) {
      throw new AppException(
        'CITY_NOT_FOUND',
        'City not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return city;
  }

  /**
   * Slug-only lookup, kept ONLY for SalonsService.registerSalon's own use — it independently
   * verifies the caller's chosen country against the resolved city (CITY_COUNTRY_MISMATCH) and
   * that behaviour is deployed and tested; switching registration to the country-scoped lookup
   * above would change that error into a bare CITY_NOT_FOUND and was deliberately left alone
   * here rather than folded into the B9 URL-restructure change.
   *
   * Ambiguous the moment two countries share a city slug (returns whichever row Postgres reaches
   * first) — every read that actually serves a public URL uses findCityByCountryAndSlugOrThrow
   * instead, which is why this one is not.
   */
  async findCityBySlugOrThrow(citySlug: string) {
    const city = await this.prisma.city.findFirst({
      where: { slug: citySlug },
    });
    if (!city) {
      throw new AppException(
        'CITY_NOT_FOUND',
        'City not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return city;
  }

  /**
   * GET cities/search — the scalable replacement for "load every city into the browser" that
   * ~99,797 imported rows make necessary (see the Phase 5 investigation report). Backed by the
   * pg_trgm GIN index on City.name added in Phase 6A's migration.
   *
   * countryId is mandatory: an unscoped search across the whole table is never allowed, matching
   * the same discipline as SalonsService.search's mandatory-context patterns. `q` shorter than
   * MIN_SEARCH_QUERY_LENGTH (after trimming) returns [] without touching the database at all —
   * an empty/1-character query is a normal "still typing" UI state, not a query worth running
   * against a 100K-row table.
   *
   * Uses a parameterized raw query (Prisma.sql tagged template — every interpolated value becomes
   * a bound query parameter, never string-concatenated SQL) because Prisma's query builder has no
   * native way to express pg_trgm's similarity()/ILIKE-with-index ranking. ILIKE substring
   * matching (not the trigram `%` similarity operator) is used for the WHERE filter itself so a
   * short query like "ben" is *guaranteed* to find "Bengaluru" regardless of trigram similarity
   * thresholds; the GIN trigram index still accelerates this ILIKE. Ranking prefers an exact
   * prefix match first, then population (empirically necessary: plain trigram similarity() for a
   * short query like "ben" scores small towns like "Benaulim"/"Beniganj" above "Bengaluru", since
   * shorter names share proportionally more of their trigram set with the query -- verified live
   * against the real dataset during Phase 6A), then trigram similarity, then alphabetical order.
   */
  async searchCities(
    query: CitySearchQueryInput,
  ): Promise<CitySearchResultDto[]> {
    const rawQuery = (query.q ?? '').trim();
    if (rawQuery.length < MIN_SEARCH_QUERY_LENGTH) return [];

    // Escape ILIKE's own wildcard characters in user input so a literal '%' or '_' in a search
    // string is matched literally, not treated as a pattern wildcard.
    const escaped = rawQuery.replace(/[\\%_]/g, '\\$&');
    const containsPattern = `%${escaped}%`;
    const prefixPattern = `${escaped}%`;
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_SEARCH_LIMIT, 1),
      50,
    );

    // Prisma stores every String/id field as Postgres `text`, never a native `uuid` column
    // (confirmed via \d cities) -- comparing against the zod-validated UUID string directly, no
    // ::uuid cast (which would fail with "operator does not exist: text = uuid").
    const conditions: Prisma.Sql[] = [
      Prisma.sql`c."countryId" = ${query.countryId}`,
      Prisma.sql`c.name ILIKE ${containsPattern} ESCAPE '\\'`,
    ];
    if (query.regionId) {
      conditions.push(Prisma.sql`c."regionId" = ${query.regionId}`);
    }

    const rows = await this.prisma.$queryRaw<CitySearchRow[]>(Prisma.sql`
      SELECT
        c.id,
        c.name,
        c.slug,
        c."countryCode"  AS "countryCode",
        r.id             AS "regionId",
        r.name           AS "regionName",
        r.code           AS "regionCode"
      FROM cities c
      LEFT JOIN "Region" r ON r.id = c."regionId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY
        (c.name ILIKE ${prefixPattern} ESCAPE '\\') DESC,
        c.population DESC NULLS LAST,
        similarity(c.name, ${rawQuery}) DESC,
        c.name ASC
      LIMIT ${limit}
    `);

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      countryCode: r.countryCode,
      region: r.regionId
        ? { id: r.regionId, name: r.regionName!, code: r.regionCode }
        : null,
    }));
  }
}
