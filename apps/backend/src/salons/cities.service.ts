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
    const city = await this.prisma.city.findUnique({
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
