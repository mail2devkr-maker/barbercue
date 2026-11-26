import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingStatus,
  GROWTH_SERVICES,
  SalonStatus,
  type GrowthServiceKey,
  type MatchedSalonDto,
  type MeasurementWindowDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, indiaDay, indiaDayStart } from './growth-support';

/**
 * Supply-aware matching and first-party measurement. Read-only: every method here only reads
 * salons, services and bookings, through fixed Prisma queries. Nothing the model writes reaches a
 * query; no price, availability or booking is ever changed.
 */
@Injectable()
export class GrowthMatchingService {
  constructor(private readonly prisma: PrismaService) {}

  private serviceFilter(
    serviceKey: GrowthServiceKey,
  ): Prisma.ServiceWhereInput {
    const terms: readonly string[] = GROWTH_SERVICES[serviceKey].terms;
    return {
      isActive: true,
      OR: terms.flatMap((t) => [
        { name: { contains: t, mode: 'insensitive' as const } },
        { category: { contains: t, mode: 'insensitive' as const } },
      ]),
    };
  }

  private bookingServiceFilter(
    serviceKey: GrowthServiceKey,
  ): Prisma.BookingServiceWhereInput {
    return {
      OR: (GROWTH_SERVICES[serviceKey].terms as readonly string[]).map((t) => ({
        serviceName: { contains: t, mode: 'insensitive' as const },
      })),
    };
  }

  /** Active, bookable salons in the city that offer the service, minus admin exclusions. */
  async matchSalons(
    cityId: string,
    serviceKey: GrowthServiceKey,
  ): Promise<MatchedSalonDto[]> {
    const excluded = (
      await this.prisma.growthSalonExclusion.findMany({
        select: { salonId: true },
      })
    ).map((e) => e.salonId);
    const salons = await this.prisma.salon.findMany({
      where: {
        cityId,
        status: SalonStatus.ACTIVE,
        bookingsPaused: false,
        id: { notIn: excluded },
        services: { some: this.serviceFilter(serviceKey) },
      },
      select: {
        id: true,
        name: true,
        localityText: true,
        locality: { select: { name: true } },
        services: {
          where: this.serviceFilter(serviceKey),
          select: { name: true, price: true },
          take: 5,
          orderBy: { price: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
      take: 500,
    });
    if (!salons.length) return [];
    const since = new Date(Date.now() - 30 * 86400_000);
    const counts = await this.prisma.booking.groupBy({
      by: ['salonId'],
      where: {
        salonId: { in: salons.map((s) => s.id) },
        status: BookingStatus.COMPLETED,
        slotStart: { gte: since },
      },
      _count: { _all: true },
    });
    const countOf = new Map(counts.map((c) => [c.salonId, c._count._all]));
    return salons.map((s) => ({
      salonId: s.id,
      name: s.name,
      locality: s.locality?.name ?? s.localityText ?? null,
      services: s.services.map((x) => ({
        name: x.name,
        pricePaise: Math.round(Number(x.price) * 100),
      })),
      completedLast30Days: countOf.get(s.id) ?? 0,
    }));
  }

  /** Average value of completed matching services in the last 90 days; null below 5 samples. */
  async avgServiceValuePaise(
    salonIds: string[],
    serviceKey: GrowthServiceKey,
  ): Promise<{ value: number | null; samples: number }> {
    if (!salonIds.length) return { value: null, samples: 0 };
    const agg = await this.prisma.bookingService.aggregate({
      _avg: { price: true },
      _count: { _all: true },
      where: {
        ...this.bookingServiceFilter(serviceKey),
        booking: {
          salonId: { in: salonIds },
          status: BookingStatus.COMPLETED,
          slotStart: { gte: new Date(Date.now() - 90 * 86400_000) },
        },
      },
    });
    const samples = agg._count._all;
    return {
      value:
        samples >= 5 && agg._avg.price != null
          ? Math.round(Number(agg._avg.price) * 100)
          : null,
      samples,
    };
  }

  /** Completed bookings with a matching service at the salons, between two India dates (inclusive). */
  async window(
    salonIds: string[],
    serviceKey: GrowthServiceKey,
    from: string,
    to: string,
  ): Promise<MeasurementWindowDto> {
    const start = indiaDayStart(from);
    const end = indiaDayStart(addDays(to, 1));
    const empty = {
      from,
      to,
      completedBookings: 0,
      serviceValuePaise: 0,
      newCustomers: 0,
    };
    if (!salonIds.length || end <= start) return empty;
    const rows = await this.prisma.bookingService.findMany({
      where: {
        ...this.bookingServiceFilter(serviceKey),
        booking: {
          salonId: { in: salonIds },
          status: BookingStatus.COMPLETED,
          slotStart: { gte: start, lt: end },
        },
      },
      select: {
        price: true,
        bookingId: true,
        booking: { select: { customerId: true } },
      },
    });
    const bookings = new Set(rows.map((r) => r.bookingId));
    const valuePaise = rows.reduce(
      (sum, r) => sum + Math.round(Number(r.price) * 100),
      0,
    );
    const customers = [
      ...new Set(
        rows.map((r) => r.booking.customerId).filter((c): c is string => !!c),
      ),
    ];
    let newCustomers = 0;
    if (customers.length) {
      const earlier = await this.prisma.booking.findMany({
        where: {
          customerId: { in: customers },
          status: BookingStatus.COMPLETED,
          slotStart: { lt: start },
        },
        select: { customerId: true },
        distinct: ['customerId'],
      });
      newCustomers = customers.length - earlier.length;
    }
    return {
      from,
      to,
      completedBookings: bookings.size,
      serviceValuePaise: valuePaise,
      newCustomers,
    };
  }

  today(): string {
    return indiaDay();
  }
}
