import { HttpStatus, Injectable } from '@nestjs/common';
import { SalonStatus, type CityDto, type LocalityDto } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

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
    const city = await this.findCityByCountryAndSlugOrThrow(countryCode, citySlug);
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

  async listLocalities(countryCode: string, citySlug: string): Promise<LocalityDto[]> {
    const city = await this.findCityByCountryAndSlugOrThrow(countryCode, citySlug);
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
    const city = await this.findCityByCountryAndSlugOrThrow(countryCode, citySlug);
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
        countryCode_slug: { countryCode: countryCode.toUpperCase(), slug: citySlug },
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
}
