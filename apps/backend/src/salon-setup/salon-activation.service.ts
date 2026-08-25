import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  ChairStatus,
  SalonSetupErrorCode,
  SalonStatus,
  StaffMemberStatus,
  type SalonSetupReadinessDto,
  type SalonStatusResultDto,
  type UpdateSalonStatusInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

/**
 * Owner self-activation — the fix for the Phase 11 blocker.
 *
 * SalonsService.registerSalon creates every self-serve salon as PENDING (ARCHITECTURE.md §17
 * called this "a moderation-friendly default nobody wired up"). Nothing could move it out of
 * that state, which made a registered salon permanently unusable: AvailabilityService
 * .getSalonOrThrow requires ACTIVE, discovery/search filters on ACTIVE, and the Phase 9 QR page
 * reports "queue unavailable" for anything else. So a real owner could register a shop and then
 * hit a dead end.
 *
 * The approved product decision is owner self-activation: the owner flips their own shop open
 * when setup is done. PENDING remains reserved as a platform-owned moderation state — the schema
 * validation only permits ACTIVE and SUSPENDED here, so an owner can open or pause their shop
 * but can never put it back into (or out of) moderation themselves.
 */
@Injectable()
export class SalonActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async updateStatus(
    userId: string,
    salonId: string,
    input: UpdateSalonStatusInput,
  ): Promise<SalonStatusResultDto> {
    await this.salonAccess.assertAccess(userId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Readiness is checked ONLY on the first opening (PENDING -> ACTIVE). Deliberately not on
    // SUSPENDED -> ACTIVE: a shop that has traded before is reopening after a pause, and blocking
    // that because a chair is temporarily under repair would lock an owner out of their own
    // business. Equally, nothing here ever demotes a salon — an already-ACTIVE shop whose last
    // barber goes inactive stays ACTIVE, and the queue engine's own capacity rule
    // (min(active staff, active chairs)) is what stops customers being seated meanwhile.
    if (
      input.status === SalonStatus.ACTIVE &&
      salon.status === SalonStatus.PENDING
    ) {
      await this.assertReadyToOpen(salonId);
    }

    const updated = await this.prisma.salon.update({
      where: { id: salonId },
      data: { status: input.status },
    });
    return { id: updated.id, status: updated.status };
  }

  /**
   * Throws SALON_SETUP_INCOMPLETE unless the salon has at least one active service, chair and
   * staff member — the three things without which a customer who finds the shop cannot actually
   * be served. The thrown error carries a SalonSetupReadinessDto in `details` so the client can
   * tick off what's already done instead of restating the whole requirement.
   */
  private async assertReadyToOpen(salonId: string): Promise<void> {
    const [serviceCount, chairCount, staffCount] = await Promise.all([
      this.prisma.service.count({ where: { salonId, isActive: true } }),
      this.prisma.chair.count({
        where: { salonId, status: ChairStatus.ACTIVE },
      }),
      this.prisma.salonStaff.count({
        where: { salonId, status: StaffMemberStatus.ACTIVE },
      }),
    ]);

    const readiness: SalonSetupReadinessDto = {
      hasActiveService: serviceCount > 0,
      hasActiveChair: chairCount > 0,
      hasActiveStaff: staffCount > 0,
    };
    if (
      readiness.hasActiveService &&
      readiness.hasActiveChair &&
      readiness.hasActiveStaff
    ) {
      return;
    }

    const missing = [
      readiness.hasActiveService ? null : 'one service',
      readiness.hasActiveChair ? null : 'one chair',
      readiness.hasActiveStaff ? null : 'one barber',
    ].filter((m): m is string => m !== null);

    throw new AppException(
      SalonSetupErrorCode.SALON_SETUP_INCOMPLETE,
      `Complete your shop setup before opening it: add at least ${formatList(missing)}.`,
      HttpStatus.CONFLICT,
      { ...readiness },
    );
  }
}

/** "one chair" | "one chair and one barber" | "one service, one chair and one barber" */
function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
