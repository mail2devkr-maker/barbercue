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

  async getCity(citySlug: string): Promise<CityDto> {
    const city = await this.findCityBySlugOrThrow(citySlug);
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

  async listLocalities(citySlug: string): Promise<LocalityDto[]> {
    const city = await this.findCityBySlugOrThrow(citySlug);
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
    citySlug: string,
    localitySlug: string,
  ): Promise<LocalityDto> {
    const city = await this.findCityBySlugOrThrow(citySlug);
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

  async findCityBySlugOrThrow(citySlug: string) {
    // INTERIM (Batch 2, B2). City slug uniqueness is now scoped by country
    // (@@unique([countryCode, slug])), so `slug` alone is no longer a unique field and Prisma
    // will not accept it in findUnique. findFirst is correct while the platform operates in a
    // single country, but it is NOT the final architecture: once a second country has a city
    // with the same slug (London GB vs London CA) this becomes ambiguous and silently returns
    // whichever row Postgres reaches first.
    //
    // FINAL: B9's country-scoped routes (/{countryCode}/{citySlug}/...) carry a countryCode into
    // every lookup, at which point this must become
    // findUnique({ where: { countryCode_slug: { countryCode, slug } } }).
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
