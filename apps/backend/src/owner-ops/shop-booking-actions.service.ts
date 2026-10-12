import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  BookingErrorCode,
  BookingSource,
  CancellationActor,
  NotificationCategory,
  NotificationDeliveryStatus,
  OwnerOpsErrorCode,
  QueueEntryStatus,
  summarizeServiceNames,
  type AuthenticatedUser,
  type CreateInShopBookingInput,
  type InShopBookingDto,
  type ShopCancelBookingInput,
  type ShopCancelBookingResultDto,
  type ShopRescheduleBookingInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { resolveSalonTimeZone } from '../common/timezone/timezone';
import { BookingsService } from '../bookings/bookings.service';
import { resolveEffectiveBookingServices } from '../bookings/effective-booking-services';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';
import { PushDispatchService } from '../push-notifications/push-dispatch.service';

/** "15 Oct, 4:30 pm" in the SHOP's own timezone (never the server's or the viewer's), or null when
 * the shop has no trustworthy timezone - the copy then simply omits the time instead of guessing. */
export function formatShopLocalDateTime(
  date: Date,
  timeZone: string | null,
): string | null {
  if (!timeZone) return null;
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone,
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return null;
  }
}

/**
 * Shop-side booking operations: cancel, reschedule, and create an in-shop appointment.
 *
 * Authorization lives HERE (the booking engine itself is shop-agnostic):
 *  - owner (of THIS salon) or a delegated platform admin: any booking of the salon;
 *  - a barber (SALON_STAFF of this salon): only a booking assigned to them - their requested
 *    barber, or the barber a linked queue entry was assigned to. Never a colleague's, never
 *    another shop's.
 * Everything customer-visible that results (the cancellation notice) goes through the notification
 * delivery ledger AFTER the business transaction has committed, so a delivery problem can never
 * roll a cancellation back and a retry can never notify twice.
 */
@Injectable()
export class ShopBookingActionsService {
  private readonly logger = new Logger(ShopBookingActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    private readonly bookings: BookingsService,
    private readonly delivery: NotificationDeliveryService,
    private readonly push: PushDispatchService,
  ) {}

  async cancel(
    user: AuthenticatedUser,
    salonId: string,
    bookingId: string,
    input: ShopCancelBookingInput,
  ): Promise<ShopCancelBookingResultDto> {
    const actor = await this.authorize(user.id, salonId, bookingId);
    const result = await this.bookings.cancelByShop({
      salonId,
      bookingId,
      actorUserId: user.id,
      actor,
      reason: input.reason ?? null,
    });
    const booking = result.booking;
    const notification = await this.notifyCustomer({
      kind: 'cancelled',
      customerId: result.customerId,
      salonId,
      bookingId,
      salonName: booking.salon.name,
      shopPhone:
        booking.salon.showPhoneToCustomers === false
          ? null
          : (booking.salon.phone ?? null),
      timeZone: resolveSalonTimeZone({
        timezone: booking.salon.timezone,
        countryCode: booking.salon.city.countryCode,
      }),
      slotStart: booking.slotStart,
      serviceName: summarizeServiceNames(
        resolveEffectiveBookingServices(booking).map((s) => s.serviceName),
      ),
      reason: input.reason ?? null,
    });
    return {
      bookingId,
      status: booking.status,
      cancelledByActor: actor,
      cancelledAt: (booking.cancelledAt ?? new Date()).toISOString(),
      notification,
    };
  }

  async reschedule(
    user: AuthenticatedUser,
    salonId: string,
    bookingId: string,
    input: ShopRescheduleBookingInput,
  ) {
    await this.authorize(user.id, salonId, bookingId);
    const moved = await this.bookings.rescheduleByShop({
      salonId,
      bookingId,
      actorUserId: user.id,
      input,
    });
    const notification = await this.notifyCustomer({
      kind: 'rescheduled',
      customerId: moved.customerId,
      salonId,
      bookingId,
      salonName: moved.booking.salonName,
      shopPhone: moved.booking.shopPhone ?? null,
      timeZone: moved.booking.salonTimezone,
      slotStart: new Date(moved.booking.slotStart),
      serviceName: moved.booking.serviceName,
      reason: null,
    });
    return { booking: moved.booking, notification };
  }

  async createInShop(
    user: AuthenticatedUser,
    salonId: string,
    input: CreateInShopBookingInput,
    idempotencyKey: string,
  ): Promise<InShopBookingDto> {
    await this.salonAccess.assertAccessOrAdminAccess(user.id, salonId);
    const { bookingId } = await this.bookings.createInShop({
      salonId,
      actorUserId: user.id,
      input,
      idempotencyKey,
    });
    return this.getInShop(salonId, bookingId);
  }

  async getInShop(
    salonId: string,
    bookingId: string,
  ): Promise<InShopBookingDto> {
    const booking = await this.prisma.booking.findFirstOrThrow({
      where: { id: bookingId, salonId },
      include: {
        services: { orderBy: { sortOrder: 'asc' } },
        service: { select: { name: true, durationMinutes: true, price: true } },
        preferredStaff: { select: { displayName: true } },
      },
    });
    return {
      id: booking.id,
      salonId: booking.salonId,
      slotStart: booking.slotStart.toISOString(),
      slotEnd: booking.slotEnd.toISOString(),
      status: booking.status,
      guestName: booking.guestName ?? '',
      guestPhone: booking.guestPhone,
      serviceNames: resolveEffectiveBookingServices(booking).map(
        (s) => s.serviceName,
      ),
      staffName: booking.preferredStaff?.displayName ?? null,
      note: booking.internalNote,
      createdAt: booking.createdAt.toISOString(),
    };
  }

  // ---------- internals ----------

  private async authorize(
    userId: string,
    salonId: string,
    bookingId: string,
  ): Promise<CancellationActor> {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    const kind = await this.salonAccess.getActorKind(userId, salonId);
    if (kind === 'OWNER') return CancellationActor.OWNER;
    if (kind === 'PLATFORM_ADMIN') return CancellationActor.ADMIN;
    if (kind === 'STAFF') {
      const me = await this.prisma.salonStaff.findFirst({
        where: { userId, salonId },
        select: { id: true },
      });
      const booking = await this.prisma.booking.findFirst({
        where: { id: bookingId, salonId },
        select: {
          preferredStaffId: true,
          queueEntries: { select: { assignedStaffId: true } },
        },
      });
      // Not found is reported exactly like "not yours": a barber must not be able to probe which
      // booking ids exist in the shop.
      const mine =
        !!me &&
        !!booking &&
        (booking.preferredStaffId === me.id ||
          booking.queueEntries.some((q) => q.assignedStaffId === me.id));
      if (!mine) {
        throw new AppException(
          OwnerOpsErrorCode.BOOKING_NOT_YOURS,
          'You can only manage appointments assigned to you.',
          HttpStatus.FORBIDDEN,
        );
      }
      return CancellationActor.STAFF;
    }
    throw new AppException(
      BookingErrorCode.BOOKING_NOT_FOUND,
      'Booking not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private async notifyCustomer(input: {
    kind: 'cancelled' | 'rescheduled';
    customerId: string | null;
    salonId: string;
    bookingId: string;
    salonName: string;
    shopPhone: string | null;
    timeZone: string | null;
    slotStart: Date;
    serviceName: string | null;
    reason: string | null;
  }): Promise<ShopCancelBookingResultDto['notification']> {
    // An in-shop guest has no FastQue account: there is nobody to notify and nothing is claimed.
    if (!input.customerId) return { inApp: 'NO_ACCOUNT', push: 'NO_ACCOUNT' };
    const type =
      input.kind === 'cancelled'
        ? 'booking.cancelled_by_shop'
        : 'booking.rescheduled_by_shop';
    const whenText = formatShopLocalDateTime(input.slotStart, input.timeZone);
    try {
      const copy = await this.push.renderShopBookingPush(
        input.customerId,
        input.kind === 'cancelled'
          ? 'shopCancelledBooking'
          : 'shopRescheduledBooking',
        { shopName: input.salonName, serviceName: input.serviceName, whenText },
      );
      const dedupeKey =
        input.kind === 'cancelled'
          ? `${type}:${input.bookingId}`
          : `${type}:${input.bookingId}:${input.slotStart.toISOString()}`;
      const outcome = await this.delivery.deliverToUser({
        dedupeKey,
        userId: input.customerId,
        type,
        inAppPayload: {
          salonId: input.salonId,
          salonName: input.salonName,
          bookingId: input.bookingId,
          bookingRef: input.bookingId.slice(0, 8).toUpperCase(),
          serviceName: input.serviceName,
          slotStart: input.slotStart.toISOString(),
          whenText,
          reason: input.reason,
          shopPhone: input.shopPhone,
          message: copy.body,
        },
        deepLink: 'account/bookings',
        push: {
          title: copy.title,
          body: copy.body,
          data: { type, bookingId: input.bookingId, salonId: input.salonId },
          category: NotificationCategory.BOOKING_UPDATES,
        },
      });
      return outcome;
    } catch (err) {
      // The cancellation/reschedule has already committed. Report the delivery as failed rather
      // than throwing: the sweep and the in-app list remain the customer's safety nets.
      this.logger.warn(
        `Could not deliver shop ${input.kind} notice for booking ${input.bookingId}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return {
        inApp: NotificationDeliveryStatus.FAILED,
        push: NotificationDeliveryStatus.FAILED,
      };
    }
  }
}

// Re-exported for tests that need the statuses a linked entry must NOT be in.
export const SEATED_QUEUE_STATUSES = [
  QueueEntryStatus.IN_SERVICE,
  QueueEntryStatus.COMPLETED,
] as const;
export const SHOP_BOOKING_SOURCES = [
  BookingSource.APP,
  BookingSource.WEB,
  BookingSource.IN_SHOP,
] as const;
