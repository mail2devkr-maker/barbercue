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
  let prisma: {
    booking: { findMany: jest.Mock };
    salon: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
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
      preferredStaff: null, // "Any staff" unless a test says otherwise
      ...overrides,
    };
  }

  beforeEach(async () => {
    tx = { booking: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    prisma = {
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      salon: { findUnique: jest.fn().mockResolvedValue({ ownerUserId: 'owner-1' }) },
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
        expect.objectContaining({ type: 'booking.arrival_check', salonId: 's1', bookingId: 'b1' }),
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

    describe('the critical arrival prompt is mandatory: notification preferences never suppress its transport', () => {
      it('STILL dispatches the push and the realtime nudge when the in-app list preference is OFF (notifyInTransaction -> false)', async () => {
        prisma.booking.findMany.mockResolvedValue([candidate()]);
        notifications.notifyInTransaction.mockResolvedValue(false); // ARRIVAL_ALERTS in-app turned off
        const count = await service.sendDueAlerts();
        expect(count).toBe(1);
        expect(realtime.emitBookingArrivalAlert).toHaveBeenCalledWith('s1', 'b1');
        expect(pushDispatch.dispatchLocalizedToUser).toHaveBeenCalledTimes(1);
      });

      it('sends exactly once per booking claim - the in-app outcome does not create extra or missing sends', async () => {
        prisma.booking.findMany.mockResolvedValue([candidate({ id: 'b1' }), candidate({ id: 'b2' })]);
        notifications.notifyInTransaction.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await service.sendDueAlerts();
        expect(pushDispatch.dispatchLocalizedToUser).toHaveBeenCalledTimes(2);
        expect(realtime.emitBookingArrivalAlert).toHaveBeenCalledTimes(2);
      });

      it('the push data is IDs + non-personal operational fields only (time and service, never customer identity)', async () => {
        prisma.booking.findMany.mockResolvedValue([candidate()]);
        await service.sendDueAlerts();
        const data = pushDispatch.dispatchLocalizedToUser.mock.calls[0][3] as Record<string, unknown>;
        expect(Object.keys(data).sort()).toEqual(['bookingId', 'salonId', 'serviceName', 'slotStart', 'type']);
        expect(data.type).toBe('booking.arrival_check');
        expect(typeof data.slotStart).toBe('string');
        expect(data.serviceName).toBe('Haircut');
      });
    });

    describe('recipients: the salon owner plus the staff member assigned to that booking - never the whole roster', () => {
      const recipientsOf = () =>
        pushDispatch.dispatchLocalizedToUser.mock.calls.map((call) => call[0] as string);
      const payloadsOf = () =>
        pushDispatch.dispatchLocalizedToUser.mock.calls.map((call) => call[3] as Record<string, unknown>);

      it('an "Any staff" booking alerts the owner only', async () => {
        prisma.booking.findMany.mockResolvedValue([candidate()]);
        await service.sendDueAlerts();
        expect(recipientsOf()).toEqual(['owner-1']);
      });

      it('a booking with an assigned (preferred) ACTIVE staff member alerts the owner AND that staff user - once each', async () => {
        prisma.booking.findMany.mockResolvedValue([
          candidate({ preferredStaff: { userId: 'staff-user-7', status: 'ACTIVE' } }),
        ]);
        const count = await service.sendDueAlerts();
        expect(count).toBe(1); // one claimed alert episode, two recipients
        expect(recipientsOf()).toEqual(['owner-1', 'staff-user-7']);
        expect(pushDispatch.dispatchLocalizedToUser).toHaveBeenCalledTimes(2);
        expect(realtime.emitBookingArrivalAlert).toHaveBeenCalledTimes(1);
      });

      it('never alerts any other staff member of the salon', async () => {
        prisma.booking.findMany.mockResolvedValue([
          candidate({ preferredStaff: { userId: 'staff-user-7', status: 'ACTIVE' } }),
        ]);
        await service.sendDueAlerts();
        expect(recipientsOf()).not.toContain('staff-user-9');
        // The query itself selects only the booking's own staff link, never the roster.
        const select = (prisma.booking.findMany.mock.calls[0][0] as { select: Record<string, unknown> }).select;
        expect(select.preferredStaff).toEqual({ select: { userId: true, status: true } });
      });

      it('does not alert an INACTIVE assigned staff member', async () => {
        prisma.booking.findMany.mockResolvedValue([
          candidate({ preferredStaff: { userId: 'staff-user-7', status: 'INACTIVE' } }),
        ]);
        await service.sendDueAlerts();
        expect(recipientsOf()).toEqual(['owner-1']);
      });

      it('alerts the owner once when the owner is also the assigned staff member', async () => {
        prisma.booking.findMany.mockResolvedValue([
          candidate({ preferredStaff: { userId: 'owner-1', status: 'ACTIVE' } }),
        ]);
        await service.sendDueAlerts();
        expect(recipientsOf()).toEqual(['owner-1']);
      });

      it('each recipient is dispatched independently on their own registered device(s) - one having none does not affect the other', async () => {
        prisma.booking.findMany.mockResolvedValue([
          candidate({ preferredStaff: { userId: 'staff-user-7', status: 'ACTIVE' } }),
        ]);
        // PushDispatchService resolves to nothing for a user without a device (and swallows provider
        // errors itself), so the loop never depends on one recipient's outcome.
        pushDispatch.dispatchLocalizedToUser.mockResolvedValue(undefined);
        await expect(service.sendDueAlerts()).resolves.toBe(1);
        expect(recipientsOf()).toEqual(['owner-1', 'staff-user-7']);
      });

      it('the staff push carries the same PII-free payload as the owner push', async () => {
        prisma.booking.findMany.mockResolvedValue([
          candidate({ preferredStaff: { userId: 'staff-user-7', status: 'ACTIVE' } }),
        ]);
        await service.sendDueAlerts();
        const [ownerData, staffData] = payloadsOf();
        expect(staffData).toEqual(ownerData);
        expect(Object.keys(staffData).sort()).toEqual(['bookingId', 'salonId', 'serviceName', 'slotStart', 'type']);
      });

      it('the Notification Center entry stays owner-only (staff get the mandatory prompt, not a list entry)', async () => {
        prisma.booking.findMany.mockResolvedValue([
          candidate({ preferredStaff: { userId: 'staff-user-7', status: 'ACTIVE' } }),
        ]);
        await service.sendDueAlerts();
        expect(notifications.notifyInTransaction).toHaveBeenCalledTimes(1);
        expect(notifications.notifyInTransaction.mock.calls[0][1]).toBe('owner-1');
      });

      it('a duplicate sweep (lost claim) alerts nobody - neither owner nor staff', async () => {
        prisma.booking.findMany.mockResolvedValue([
          candidate({ preferredStaff: { userId: 'staff-user-7', status: 'ACTIVE' } }),
        ]);
        tx.booking.updateMany.mockResolvedValue({ count: 0 });
        await expect(service.sendDueAlerts()).resolves.toBe(0);
        expect(pushDispatch.dispatchLocalizedToUser).not.toHaveBeenCalled();
      });
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

    describe('who sees which prompts (recipient scope)', () => {
      const whereOf = () =>
        (prisma.booking.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;

      it('the salon owner sees every eligible booking of the salon (no staff filter)', async () => {
        prisma.salon.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' });
        await service.getEligibleAlerts('owner-1', 's1');
        expect(whereOf()).not.toHaveProperty('preferredStaff');
      });

      it('a staff member sees ONLY the bookings assigned to them', async () => {
        prisma.salon.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' });
        await service.getEligibleAlerts('staff-user-7', 's1');
        expect(whereOf().preferredStaff).toEqual({ is: { userId: 'staff-user-7', status: 'ACTIVE' } });
      });

      it('a delegated platform admin sees the whole salon', async () => {
        salonAccess.assertAccessOrAdminAccess.mockResolvedValue('PLATFORM_ADMIN');
        await service.getEligibleAlerts('admin-1', 's1');
        expect(prisma.salon.findUnique).not.toHaveBeenCalled();
        expect(whereOf()).not.toHaveProperty('preferredStaff');
      });

      it('access is still checked first - an outsider never reaches the query', async () => {
        salonAccess.assertAccessOrAdminAccess.mockRejectedValue(new Error('SALON_ACCESS_DENIED'));
        await expect(service.getEligibleAlerts('nobody', 's1')).rejects.toThrow('SALON_ACCESS_DENIED');
        expect(prisma.booking.findMany).not.toHaveBeenCalled();
      });
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
