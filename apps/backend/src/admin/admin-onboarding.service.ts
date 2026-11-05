import { Injectable } from '@nestjs/common';
import {
  ChairStatus,
  SalonStatus,
  StaffMemberStatus,
  type AdminOnboardingDto,
  type AdminOnboardingShopDto,
  type AdminOnboardingStage,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';

export const ADMIN_ONBOARDING_MAX_SHOPS = 300;
const DAY_MS = 86_400_000;
export const ONBOARDING_STAGES: AdminOnboardingStage[] = [
  'REGISTERED',
  'VERIFIED',
  'CONFIGURED',
  'LIVE',
  'FIRST_CUSTOMER',
];

/**
 * New shop onboarding funnel for the admin dashboard (SHOPS -> New Shop Onboarding): shops registered
 * in the last N days and how far each got - verified, configured (one active service, chair and staff
 * member: the same rule as opening a shop), live (ACTIVE), first customer (any booking or queue entry).
 * Stages are cumulative and computed from existing records. Shop names only, no owner contact.
 */
@Injectable()
export class AdminOnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async getOnboarding(
    days: number,
    now = new Date(),
  ): Promise<AdminOnboardingDto> {
    const since = new Date(now.getTime() - days * DAY_MS);
    const salons = await this.prisma.salon.findMany({
      where: { createdAt: { gte: since } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: ADMIN_ONBOARDING_MAX_SHOPS,
      select: {
        id: true,
        publicId: true,
        name: true,
        status: true,
        createdAt: true,
        city: { select: { name: true } },
        verification: { select: { status: true, reviewedAt: true } },
      },
    });
    const ids = salons.map((s) => s.id);
    const count = <T extends { salonId: string; _count: { _all: number } }>(
      rows: T[],
    ) => new Map(rows.map((r) => [r.salonId, r._count._all]));
    const first = <
      T extends {
        salonId: string;
        _min: { createdAt?: Date | null; joinedAt?: Date | null };
      },
    >(
      rows: T[],
    ) =>
      new Map(
        rows.map(
          (r) =>
            [r.salonId, r._min.createdAt ?? r._min.joinedAt ?? null] as const,
        ),
      );
    const [services, chairs, staff, bookings, queue] = ids.length
      ? await Promise.all([
          this.prisma.service.groupBy({
            by: ['salonId'],
            where: { salonId: { in: ids }, isActive: true },
            _count: { _all: true },
          }),
          this.prisma.chair.groupBy({
            by: ['salonId'],
            where: { salonId: { in: ids }, status: ChairStatus.ACTIVE },
            _count: { _all: true },
          }),
          this.prisma.salonStaff.groupBy({
            by: ['salonId'],
            where: { salonId: { in: ids }, status: StaffMemberStatus.ACTIVE },
            _count: { _all: true },
          }),
          this.prisma.booking.groupBy({
            by: ['salonId'],
            where: { salonId: { in: ids } },
            _min: { createdAt: true },
          }),
          this.prisma.queueEntry.groupBy({
            by: ['salonId'],
            where: { salonId: { in: ids } },
            _min: { joinedAt: true },
          }),
        ])
      : [[], [], [], [], []];
    const nServices = count(services);
    const nChairs = count(chairs);
    const nStaff = count(staff);
    const firstBooking = first(bookings);
    const firstQueue = first(queue);

    const shops = salons.map((s): AdminOnboardingShopDto => {
      const b = firstBooking.get(s.id) ?? null;
      const q = firstQueue.get(s.id) ?? null;
      const firstCustomer = b && q ? (b < q ? b : q) : (b ?? q);
      const verification = (s.verification?.status ??
        'NONE') as AdminOnboardingShopDto['verification'];
      const svc = nServices.get(s.id) ?? 0;
      const ch = nChairs.get(s.id) ?? 0;
      const st = nStaff.get(s.id) ?? 0;
      const verified = verification === 'APPROVED';
      const configured = svc > 0 && ch > 0 && st > 0;
      const live = s.status === SalonStatus.ACTIVE;
      // The furthest step reached, for the per-shop badge; the funnel counts each step's real condition.
      const stage: AdminOnboardingStage = firstCustomer
        ? 'FIRST_CUSTOMER'
        : live
          ? 'LIVE'
          : configured
            ? 'CONFIGURED'
            : verified
              ? 'VERIFIED'
              : 'REGISTERED';
      return {
        id: s.id,
        publicId: s.publicId,
        name: s.name,
        city: s.city?.name ?? null,
        status: s.status as AdminOnboardingShopDto['status'],
        registeredAt: s.createdAt.toISOString(),
        verification,
        verifiedAt: verified
          ? (s.verification?.reviewedAt?.toISOString() ?? null)
          : null,
        services: svc,
        chairs: ch,
        staff: st,
        firstCustomerAt: firstCustomer ? firstCustomer.toISOString() : null,
        stage,
        daysSinceRegistered: Math.floor(
          (now.getTime() - s.createdAt.getTime()) / DAY_MS,
        ),
      };
    });
    // Each step counts the shops that actually meet it (an older shop can be open without ever having
    // been verified, so a cumulative count would overstate verification).
    const meets = (test: (s: AdminOnboardingShopDto) => boolean) =>
      shops.filter(test).length;
    return {
      days,
      generatedAt: now.toISOString(),
      funnel: {
        REGISTERED: shops.length,
        VERIFIED: meets((s) => s.verification === 'APPROVED'),
        CONFIGURED: meets((s) => s.services > 0 && s.chairs > 0 && s.staff > 0),
        LIVE: meets((s) => s.status === SalonStatus.ACTIVE),
        FIRST_CUSTOMER: meets((s) => s.firstCustomerAt !== null),
      },
      shops,
    };
  }
}
