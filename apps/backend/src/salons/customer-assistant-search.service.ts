import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CUSTOMER_ASSISTANT_SEARCH_LIMITS,
  type CustomerAssistantSearchInput,
  type CustomerAssistantSearchResultDto,
} from '@barbercue/shared';
import { AvailabilityService } from '../bookings/availability.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalonsService } from './salons.service';

/**
 * A deliberately deterministic customer-assistant foundation: searches published catalog data
 * and asks the existing booking engine for current availability. It does not call an AI provider,
 * create a reservation, or promise a slot remains free after this read; the existing booking
 * endpoint revalidates capacity atomically when the customer confirms.
 */
@Injectable()
export class CustomerAssistantSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salons: SalonsService,
    private readonly availability: AvailabilityService,
  ) {}

  async search(
    input: CustomerAssistantSearchInput,
  ): Promise<CustomerAssistantSearchResultDto> {
    const salonPage = await this.salons.search({
      service: input.serviceQuery,
      ...(input.city ? { city: input.city } : {}),
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      ...(input.lat !== undefined ? { lat: input.lat, lng: input.lng } : {}),
      ...(input.radiusKm !== undefined ? { radiusKm: input.radiusKm } : {}),
      ...(input.maxPrice !== undefined ? { priceMax: input.maxPrice } : {}),
      limit: CUSTOMER_ASSISTANT_SEARCH_LIMITS.maxCandidatesScanned,
    });
    const salons = salonPage.items;
    const candidates = [] as CustomerAssistantSearchResultDto['candidates'];

    if (salons.length === 0) {
      return this.result(input.date, candidates);
    }

    // Re-read the actual active Service rows to return stable identifiers and authoritative prices
    // rather than relying on a text-search match as proof of the specific service details.
    const services = await this.prisma.service.findMany({
      where: {
        salonId: { in: salons.map((salon) => salon.id) },
        isActive: true,
        ...(input.maxPrice !== undefined
          ? { price: { lte: new Prisma.Decimal(input.maxPrice) } }
          : {}),
        OR: [
          { name: { contains: input.serviceQuery, mode: 'insensitive' } },
          { category: { contains: input.serviceQuery, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        salonId: true,
        name: true,
        category: true,
        price: true,
        durationMinutes: true,
      },
      orderBy: [{ price: 'asc' }, { id: 'asc' }],
    });

    const servicesBySalon = new Map<string, typeof services>();
    for (const service of services) {
      const rows = servicesBySalon.get(service.salonId) ?? [];
      rows.push(service);
      servicesBySalon.set(service.salonId, rows);
    }

    for (const salon of salons) {
      if (candidates.length >= input.limit) break;
      // AvailabilityService currently treats an owner-paused shop as not bookable, including
      // future dates. Keep this endpoint consistent with that established booking contract.
      if (salon.isClosedForToday) continue;

      const rows = servicesBySalon.get(salon.id) ?? [];
      const service = [...rows].sort((left, right) => {
        const leftNameMatch = left.name
          .toLocaleLowerCase()
          .includes(input.serviceQuery.toLocaleLowerCase());
        const rightNameMatch = right.name
          .toLocaleLowerCase()
          .includes(input.serviceQuery.toLocaleLowerCase());
        return (
          Number(rightNameMatch) - Number(leftNameMatch) ||
          Number(left.price) - Number(right.price) ||
          left.id.localeCompare(right.id)
        );
      })[0];
      if (!service) continue;

      const timeZone = await this.availability.getSalonTimeZone(salon.id);
      if (!timeZone) continue;

      const availableSlots = (
        await this.availability.getAvailability(
          salon.id,
          [service.id],
          input.date,
        )
      )
        .filter((slot) => slot.available)
        .slice(0, CUSTOMER_ASSISTANT_SEARCH_LIMITS.maxSlotsPerSalon)
        .map(({ slotStart, slotEnd }) => ({ slotStart, slotEnd }));

      if (availableSlots.length === 0) continue;
      candidates.push({
        salon: {
          id: salon.id,
          publicId: salon.publicId,
          name: salon.name,
          slug: salon.slug,
          citySlug: salon.citySlug,
          countryCode: salon.countryCode,
          distanceKm: salon.distanceKm,
        },
        service: {
          id: service.id,
          name: service.name,
          category: service.category,
          price: Number(service.price),
          durationMinutes: service.durationMinutes,
        },
        currency: salon.currency,
        timeZone,
        availableSlots,
      });
    }

    return this.result(input.date, candidates);
  }

  private result(
    date: string,
    candidates: CustomerAssistantSearchResultDto['candidates'],
  ): CustomerAssistantSearchResultDto {
    return {
      mode: 'DETERMINISTIC_CATALOG_AVAILABILITY',
      generated: false,
      bookingConfirmationRequired: true,
      date,
      candidates,
    };
  }
}
