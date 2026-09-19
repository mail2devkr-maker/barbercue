import { Test } from '@nestjs/testing';
import { ArrivalAlertsService } from './arrival-alerts.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PushDispatchService } from '../push-notifications/push-dispatch.service';
import { CancellationPolicyService } from './cancellation-policy.service';

const FLAT_ZERO_POLICY = {
  salonId: 's1',
  freeCancellationWindowMinutes: 60,
  lateCancellationChargeType: 'FLAT' as const,
  lateCancellationChargeValue: 0,
  noShowChargeType: 'FLAT' as const,
  noShowChargeValue: 0,
  appointmentArrivalGraceMinutes: 10,
  queueCallResponseGraceMinutes: 3,
};

describe('ArrivalAlertsService', () => {
  let service: ArrivalAlertsService;
  let tx: { booking: { updateMany: jest.Mock } };
  let prisma: { booking: { findMany: jest.Mock }; $transaction: jest.Mock };
  let cancellationPolicy: { getEffectivePolicy: jest.Mock };
  let salonAccess: { assertAccessOrAdminAccess: jest.Mock };
  let realtime: { emitBookingArrivalAlert: jest.Mock };
  let notifications: { notifyInTransaction: jest.Mock };
  let pushDispatch: { dispatchLocalizedToUser: jest.Mock };

  function candidate(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'b1',
      salonId: 's1',
      slotStart: new Date(Date.now() + 3 * 60_000), // 3 minutes out — inside the 5-minute lead
      serviceId: 'sv1',
      service: { name: 'Haircut', durationMinutes: 30, price: 500 },
      services: [
        { serviceId: 'sv1', serviceName: 'Haircut', durationMinutes: 30, price: 500 },
      ],
      salon: { ownerUserId: 'owner-1', currency: 'INR' },
      ...overrides,
    };
  }

  beforeEach(async () => {
    tx = { booking: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    prisma = {
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((callback: (t: typeof tx) => unknown) => callback(tx)),
    };
    cancellationPolicy = { getEffectivePolicy: jest.fn().mockResolvedValue(FLAT_ZERO_POLICY) };
    salonAccess = { assertAccessOrAdminAccess: jest.fn().mockResolvedValue('STAFF_OR_OWNER') };
    realtime = { emitBookingArrivalAlert: jest.fn() };
    notifications = { notifyInTransaction: jest.fn().mockResolvedValue(true) };
    pushDispatch = { dispatchLocalizedToUser: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ArrivalAlertsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CancellationPolicyService, useValue: cancellationPolicy },
        { provide: SalonAccessService, useValue: salonAccess },
        { provide: RealtimeGateway, useValue: realtime },
        { provide: NotificationsService, useValue: notifications },
        { provide: PushDispatchService, useValue: pushDispatch },
      ],
    }).compile();
    service = moduleRef.get(ArrivalAlertsService);
  });

  describe('sendDueAlerts', () => {
    it('queries only CONFIRMED, not-yet-alerted, no-queue-entry bookings due within the lead window', async () => {
      await service.sendDueAlerts();
      const call = prisma.booking.findMany.mock.calls[0][0] as {
        where: { status: string; arrivalAlertSentAt: null; queueEntries: { none: Record<string, never> } };
      };
      expect(call.where.status).toBe('CONFIRMED');
      expect(call.where.arrivalAlertSentAt).toBeNull();
      expect(call.where.queueEntries).toEqual({ none: {} });
    });

    it('sends exactly one notification, one push, and one realtime emit per due booking, and claims arrivalAlertSentAt', async () => {
      prisma.booking.findMany.mockResolvedValue([candidate()]);
      const count = await service.sendDueAlerts();
      expect(count).toBe(1);
      expect(tx.booking.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'b1', status: 'CONFIRMED', arrivalAlertSentAt: null }),
          data: expect.objectContaining({ arrivalAlertSentAt: expect.any(Date) }),
        }),
      );
      expect(notifications.notifyInTransaction).toHaveBeenCalledWith(
        tx,
        'owner-1',
        'owner.booking.arrival_check',
        expect.objectContaining({ salonId: 's1', bookingId: 'b1' }),
        'dashboard/salons/s1/bookings',
      );
      expect(realtime.emitBookingArrivalAlert).toHaveBeenCalledWith('s1', 'b1');
      expect(pushDispatch.dispatchLocalizedToUser).toHaveBeenCalledWith(
        'owner-1',
        'arrivalCheck',
        'Haircut',
        expect.objectContaining({ salonId: 's1', bookingId: 'b1' }),
      );
    });

    it('never double-sends: a lost updateMany claim (already sent by a concurrent/duplicate sweep run) skips the notification entirely', async () => {
      prisma.booking.findMany.mockResolvedValue([candidate()]);
      tx.booking.updateMany.mockResolvedValue({ count: 0 });
      const count = await service.sendDueAlerts();
      expect(count).toBe(0);
      expect(notifications.notifyInTransaction).not.toHaveBeenCalled();
      expect(realtime.emitBookingArrivalAlert).not.toHaveBeenCalled();
      expect(pushDispatch.dispatchLocalizedToUser).not.toHaveBeenCalled();
    });

    it('does nothing when there are no due candidates', async () => {
      const count = await service.sendDueAlerts();
      expect(count).toBe(0);
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('getEligibleAlerts', () => {
    it('checks salon access before reading anything', async () => {
      await service.getEligibleAlerts('op-1', 's1');
      expect(salonAccess.assertAccessOrAdminAccess).toHaveBeenCalledWith('op-1', 's1');
    });

    it('never invents a customer name — always the truthful "Your {service} customer" fallback', async () => {
      prisma.booking.findMany.mockResolvedValue([candidate()]);
      const alerts = await service.getEligibleAlerts('op-1', 's1');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].customerDisplayName).toBe('Your Haircut customer');
      expect(alerts[0].customerDisplayName).not.toMatch(/@|\d{5,}/); // never an email or phone number
    });

    it('graceExpired is false and noShowChargePreview is null before the arrival grace has elapsed', async () => {
      prisma.booking.findMany.mockResolvedValue([
        candidate({ slotStart: new Date(Date.now() - 2 * 60_000) }), // 2 min past slot, 10 min grace
      ]);
      const alerts = await service.getEligibleAlerts('op-1', 's1');
      expect(alerts[0].graceExpired).toBe(false);
      expect(alerts[0].noShowChargePreview).toBeNull();
    });

    it('graceExpired is true and noShowChargePreview reflects the live backend-authoritative policy once the grace has elapsed', async () => {
      prisma.booking.findMany.mockResolvedValue([
        candidate({ slotStart: new Date(Date.now() - 20 * 60_000) }), // 20 min past slot, 10 min grace
      ]);
      cancellationPolicy.getEffectivePolicy.mockResolvedValue({
        ...FLAT_ZERO_POLICY,
        noShowChargeType: 'FLAT',
        noShowChargeValue: 150,
      });
      const alerts = await service.getEligibleAlerts('op-1', 's1');
      expect(alerts[0].graceExpired).toBe(true);
      expect(alerts[0].noShowChargePreview).toBe(150);
    });
  });
});
