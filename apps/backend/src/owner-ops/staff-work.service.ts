import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingStatus,
  QueueEntrySource,
  QueueEntryStatus,
  QueueErrorCode,
  ServiceSessionStatus,
  StaffMemberStatus,
  type StaffAppointmentDto,
  type StaffWorkDto,
  type StaffWorkItemDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { AvailabilityService } from '../bookings/availability.service';
import { ReservationService } from '../bookings/reservation.service';
import { zonedDayBounds } from '../common/timezone/timezone';
import { resolveEffectiveBookingServices } from '../bookings/effective-booking-services';

const GUEST_LABEL = 'FastQue customer';

/**
 * A barber's own working view: the service they are performing, who is waiting (and which of those
 * they may take), and their appointments today. Strictly scoped to the signed-in barber and their
 * own shop:
 *  - other barbers' customers are never returned (only the shop-wide waiting list, WITHOUT phone
 *    numbers - the same least-privilege line the public queue draws);
 *  - the barber's own current customer and assigned appointments include a phone number, because
 *    they need to reach them;
 *  - there are no payment, subscription, billing or settings fields anywhere in this DTO.
 */
@Injectable()
export class StaffWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    private readonly availability: AvailabilityService,
    private readonly reservations: ReservationService,
  ) {}

  async getMyWork(userId: string, salonId: string): Promise<StaffWorkDto> {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    const revision = Date.now();
    const me = await this.prisma.salonStaff.findFirst({
      where: { userId, salonId },
      include: {
        salon: { select: { name: true } },
        services: { select: { serviceId: true } },
      },
    });
    if (!me) {
      throw new AppException(
        QueueErrorCode.NOT_YOUR_STAFF_PROFILE,
        'You are not on this shop’s barber roster.',
        HttpStatus.FORBIDDEN,
      );
    }

    const timeZone = await this.availability.getSalonTimeZone(salonId);
    const dayBounds = timeZone ? zonedDayBounds(new Date(), timeZone) : null;
    const dayStart = dayBounds?.start ?? new Date(Date.now() - 24 * 3_600_000);
    const dayEnd = dayBounds?.end ?? new Date(Date.now() + 24 * 3_600_000);
    const onDuty =
      me.status === StaffMemberStatus.ACTIVE && !me.accessRevokedAt;
    const qualified = new Set(me.services.map((s) => s.serviceId));

    const [
      availability,
      currentSession,
      waitingRows,
      bookingRows,
      completedToday,
    ] = await Promise.all([
      this.reservations.getStaffAvailabilityState(
        this.prisma,
        salonId,
        me.id,
        onDuty,
      ),
      this.prisma.serviceSession.findFirst({
        where: { staffId: me.id, status: ServiceSessionStatus.ACTIVE },
        include: {
          chair: { select: { label: true } },
          service: { select: { name: true } },
          queueEntry: {
            select: {
              id: true,
              tokenNumber: true,
              status: true,
              contactName: true,
              contactPhone: true,
              customer: { select: { phone: true } },
            },
          },
        },
      }),
      this.prisma.queueEntry.findMany({
        where: {
          salonId,
          status: { in: [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED] },
        },
        include: {
          service: { select: { name: true } },
          booking: {
            select: {
              preferredStaffId: true,
              serviceId: true,
              service: {
                select: { name: true, durationMinutes: true, price: true },
              },
              services: {
                select: {
                  serviceId: true,
                  serviceName: true,
                  durationMinutes: true,
                  price: true,
                },
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.booking.findMany({
        where: {
          salonId,
          slotStart: { gte: dayStart, lt: dayEnd },
          status: {
            in: [
              BookingStatus.CONFIRMED,
              BookingStatus.PENDING_PAYMENT,
              BookingStatus.COMPLETED,
            ],
          },
          OR: [
            { preferredStaffId: me.id },
            { queueEntries: { some: { assignedStaffId: me.id } } },
          ],
        },
        include: {
          customer: { select: { phone: true } },
          service: {
            select: { name: true, durationMinutes: true, price: true },
          },
          services: { orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { slotStart: 'asc' },
      }),
      this.prisma.serviceSession.count({
        where: {
          staffId: me.id,
          status: ServiceSessionStatus.COMPLETED,
          endedAt: { gte: dayStart },
        },
      }),
    ]);

    const current: StaffWorkItemDto | null = currentSession
      ? {
          queueEntryId: currentSession.queueEntry.id,
          serviceSessionId: currentSession.id,
          tokenNumber: currentSession.queueEntry.tokenNumber,
          customerLabel: currentSession.queueEntry.contactName ?? GUEST_LABEL,
          customerPhone:
            currentSession.queueEntry.contactPhone ??
            currentSession.queueEntry.customer?.phone ??
            null,
          serviceName: currentSession.service.name,
          startedAt: currentSession.startedAt.toISOString(),
          status: currentSession.queueEntry.status,
          chairLabel: currentSession.chair.label,
        }
      : null;

    let position = 0;
    const waiting = waitingRows.map((entry) => {
      if (entry.status === QueueEntryStatus.WAITING) position += 1;
      const serviceIds = entry.booking
        ? resolveEffectiveBookingServices(entry.booking).map((s) => s.serviceId)
        : entry.serviceId
          ? [entry.serviceId]
          : [];
      const preferred =
        entry.source === QueueEntrySource.APPOINTMENT
          ? (entry.booking?.preferredStaffId ?? null)
          : (entry.preferredStaffId ?? null);
      const eligible =
        onDuty &&
        serviceIds.length > 0 &&
        serviceIds.every((id) => qualified.has(id)) &&
        (preferred === null || preferred === me.id) &&
        entry.arrivedAt !== null;
      const serviceName = entry.booking
        ? resolveEffectiveBookingServices(entry.booking)
            .map((s) => s.serviceName)
            .join(' + ')
        : (entry.service?.name ?? null);
      return {
        queueEntryId: entry.id,
        serviceSessionId: null,
        tokenNumber: entry.tokenNumber,
        customerLabel: entry.contactName ?? GUEST_LABEL,
        // No phone for someone else's customer.
        customerPhone: null,
        serviceName,
        startedAt: null,
        status: entry.status,
        chairLabel: null,
        eligible,
        position: entry.status === QueueEntryStatus.WAITING ? position : 0,
      };
    });

    const appointmentsToday: StaffAppointmentDto[] = bookingRows.map((b) => ({
      bookingId: b.id,
      slotStart: b.slotStart.toISOString(),
      slotEnd: b.slotEnd.toISOString(),
      status: b.status,
      serviceNames: resolveEffectiveBookingServices(b).map(
        (s) => s.serviceName,
      ),
      customerLabel: b.guestName ?? GUEST_LABEL,
      customerPhone: b.guestPhone ?? b.customer?.phone ?? null,
      source: b.source === 'IN_SHOP' ? 'IN_SHOP' : 'ONLINE',
    }));

    return {
      salonId,
      salonName: me.salon.name,
      staffId: me.id,
      displayName: me.displayName,
      status: me.status,
      availabilityState: availability.availabilityState,
      current,
      waiting,
      appointmentsToday,
      completedToday,
      revision,
    };
  }
}
