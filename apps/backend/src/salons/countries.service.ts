import { Injectable } from '@nestjs/common';
import type { CountryDto, RegionDto } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CountriesService {
  constructor(private readonly prisma: PrismaService) {}

  // ~250 rows, intentionally unpaginated -- small enough to load whole (Phase 5 investigation
  // report). hasSubdivisions is returned as-is (currently the schema default `false` for every
  // row -- see Phase 4A/6A: deliberately not derived here) so the frontend never needs it; the
  // real signal for "does this country have a Region step" is whether listRegions() below
  // returns anything.
  async listCountries(): Promise<CountryDto[]> {
    const countries = await this.prisma.country.findMany({
      orderBy: { name: 'asc' },
    });
    return countries.map((c) => ({
      id: c.id,
      name: c.name,
      isoCode2: c.isoCode2,
      hasSubdivisions: c.hasSubdivisions,
    }));
  }

  // No existence check against Country is performed for `countryId`: a well-formed UUID that
  // doesn't correspond to any Country simply has zero matching Region rows, which is exactly the
  // same, already-correct "[]" response an existing country with no regions returns. Region rows
  // are never fabricated for a country that genuinely has none (Phase 5's approved UX decision).
  async listRegions(countryId: string): Promise<RegionDto[]> {
    const regions = await this.prisma.region.findMany({
      where: { countryId },
      orderBy: { name: 'asc' },
    });
    return regions.map((r) => ({ id: r.id, name: r.name, code: r.code }));
  }
}
