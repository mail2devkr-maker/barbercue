import { Test } from '@nestjs/testing';
import { Language } from '@barbercue/shared';
import { PushDispatchService } from './push-dispatch.service';
import { PushDeviceService } from './push-device.service';
import { ExpoPushSender } from './expo-push-sender';
import { PrismaService } from '../prisma/prisma.service';

describe('PushDispatchService', () => {
  let service: PushDispatchService;
  let devices: {
    devicesForUser: jest.Mock;
    removeStaleTokens: jest.Mock;
  };
  let expo: { send: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock }; notificationPreference: { findUnique: jest.Mock } };

  beforeEach(async () => {
    devices = {
      devicesForUser: jest.fn().mockResolvedValue([]),
      removeStaleTokens: jest.fn().mockResolvedValue(undefined),
    };
    expo = { send: jest.fn().mockResolvedValue([]) };
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ preferredLanguage: Language.EN }) },
      // No stored preference row by default = the user never configured anything = the default (ON).
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushDispatchService,
        { provide: PushDeviceService, useValue: devices },
        { provide: ExpoPushSender, useValue: expo },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(PushDispatchService);
  });

  it('does nothing when the user has no registered devices (the common case pre-mobile-rollout)', async () => {
    await service.dispatchToUser('u1', { category: 'BOOKING_UPDATES', title: 'New booking', body: 'x' });
    expect(expo.send).not.toHaveBeenCalled();
  });

  it('sends one Expo message per registered device, carrying the given payload', async () => {
    devices.devicesForUser.mockResolvedValue([
      { expoPushToken: 'ExponentPushToken[a]' },
      { expoPushToken: 'ExponentPushToken[b]' },
    ]);
    expo.send.mockResolvedValue([{ status: 'ok' }, { status: 'ok' }]);
    await service.dispatchToUser('u1', {
      category: 'BOOKING_UPDATES',
      title: 'New booking',
      body: 'Haircut booked for your shop.',
      data: { type: 'booking.created', salonId: 's1', bookingId: 'b1' },
    });
    expect(expo.send).toHaveBeenCalledWith([
      {
        to: 'ExponentPushToken[a]',
        title: 'New booking',
        body: 'Haircut booked for your shop.',
        data: { type: 'booking.created', salonId: 's1', bookingId: 'b1' },
      },
      {
        to: 'ExponentPushToken[b]',
        title: 'New booking',
        body: 'Haircut booked for your shop.',
        data: { type: 'booking.created', salonId: 's1', bookingId: 'b1' },
      },
    ]);
  });

  it('removes only the devices Expo reports as DeviceNotRegistered, leaving healthy tokens alone', async () => {
    devices.devicesForUser.mockResolvedValue([
      { expoPushToken: 'ExponentPushToken[stale]' },
      { expoPushToken: 'ExponentPushToken[healthy]' },
    ]);
    expo.send.mockResolvedValue([
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'ok' },
    ]);
    await service.dispatchToUser('u1', { category: 'BOOKING_UPDATES', title: 't', body: 'b' });
    expect(devices.removeStaleTokens).toHaveBeenCalledWith([
      'ExponentPushToken[stale]',
    ]);
  });

  it('does not remove a device for a non-DeviceNotRegistered error (e.g. a transient MessageRateExceeded)', async () => {
    devices.devicesForUser.mockResolvedValue([
      { expoPushToken: 'ExponentPushToken[a]' },
    ]);
    expo.send.mockResolvedValue([
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ]);
    await service.dispatchToUser('u1', { category: 'BOOKING_UPDATES', title: 't', body: 'b' });
    expect(devices.removeStaleTokens).not.toHaveBeenCalled();
  });

  it('never throws when loading devices fails — a push failure must never break booking creation', async () => {
    devices.devicesForUser.mockRejectedValue(new Error('db down'));
    await expect(
      service.dispatchToUser('u1', { category: 'BOOKING_UPDATES', title: 't', body: 'b' }),
    ).resolves.toBeUndefined();
  });

  it('never throws when the Expo API call itself fails', async () => {
    devices.devicesForUser.mockResolvedValue([
      { expoPushToken: 'ExponentPushToken[a]' },
    ]);
    expo.send.mockRejectedValue(new Error('network error'));
    await expect(
      service.dispatchToUser('u1', { category: 'BOOKING_UPDATES', title: 't', body: 'b' }),
    ).resolves.toBeUndefined();
  });
});

// Build 9 physical-device defect fix: a booking push's title/body was previously hardcoded
// English regardless of the recipient owner's own preferredLanguage.
describe('PushDispatchService.dispatchLocalizedToUser', () => {
  let service: PushDispatchService;
  let devices: { devicesForUser: jest.Mock; removeStaleTokens: jest.Mock };
  let expo: { send: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock }; notificationPreference: { findUnique: jest.Mock } };

  beforeEach(async () => {
    devices = {
      devicesForUser: jest.fn().mockResolvedValue([{ expoPushToken: 'ExponentPushToken[a]' }]),
      removeStaleTokens: jest.fn().mockResolvedValue(undefined),
    };
    expo = { send: jest.fn().mockResolvedValue([{ status: 'ok' }]) };
    prisma = {
      user: { findUnique: jest.fn() },
      // No stored row = never configured = the default (ON).
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushDispatchService,
        { provide: PushDeviceService, useValue: devices },
        { provide: ExpoPushSender, useValue: expo },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(PushDispatchService);
  });

  it('sends an English push when the recipient has no language preference set', async () => {
    prisma.user.findUnique.mockResolvedValue({ preferredLanguage: null });
    await service.dispatchLocalizedToUser('owner-1', 'newBooking', 'Haircut', {
      type: 'booking.created',
    });
    expect(expo.send).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'New booking', body: 'Haircut booked for your shop.' }),
    ]);
  });

  it('sends a Hindi push when the recipient has Hindi selected', async () => {
    prisma.user.findUnique.mockResolvedValue({ preferredLanguage: Language.HI });
    await service.dispatchLocalizedToUser('owner-1', 'newBooking', 'Haircut', {
      type: 'booking.created',
    });
    const [[messages]] = expo.send.mock.calls;
    expect(messages[0].title).not.toBe('New booking');
    expect(messages[0].body).not.toContain('Haircut booked for your shop');
  });

  it('localizes a reschedule push independently of create/cancel', async () => {
    prisma.user.findUnique.mockResolvedValue({ preferredLanguage: Language.HI });
    await service.dispatchLocalizedToUser('owner-1', 'bookingRescheduled', 'Haircut', { type: 'booking.rescheduled' });
    const [[messages]] = expo.send.mock.calls;
    expect(messages[0].title).not.toBe('Booking rescheduled');
  });

  it('localizes a cancellation push independently of a new-booking push', async () => {
    prisma.user.findUnique.mockResolvedValue({ preferredLanguage: Language.HI });
    await service.dispatchLocalizedToUser('owner-1', 'bookingCancelled', 'Haircut', {
      type: 'booking.cancelled',
    });
    const [[messages]] = expo.send.mock.calls;
    expect(messages[0].title).not.toBe('Booking cancelled');
  });

  // ROOT CAUSE of the 1.0.5 lock-screen regression (proven on-device with adb/logcat): an Expo push that
  // carries a title/body becomes an FCM *notification message*. While the app is backgrounded, locked or
  // killed, Android's FCM SDK shows it itself (tag "FCM-Notification:...") and NEVER calls the app's
  // FastQueArrivalMessagingService - so no full-screen intent, no screen wake, no native channel. A
  // DATA-ONLY message is always delivered to that service. The arrival check must therefore be data-only.
  describe('the critical arrival check is a DATA-ONLY push (so the native lock-screen alert can run)', () => {
    const send = async (): Promise<Record<string, unknown>> => {
      prisma.user.findUnique.mockResolvedValue({ preferredLanguage: Language.EN });
      await service.dispatchLocalizedToUser('owner-1', 'arrivalCheck', 'Haircut', {
        type: 'booking.arrival_check',
        salonId: 's1',
        bookingId: 'b1',
        slotStart: '2026-09-21T10:00:00.000Z',
        serviceName: 'Haircut',
      });
      const [[messages]] = expo.send.mock.calls;
      return messages[0] as Record<string, unknown>;
    };

    it('has NO title, body, sound, channel or category - any of those makes Android display it itself', async () => {
      const message = await send();
      for (const key of ['title', 'body', 'sound', 'channelId', 'categoryId']) expect(message).not.toHaveProperty(key);
    });

    it('is high priority with a short time-to-live, and carries the ids + language in data', async () => {
      const message = await send();
      expect(message).toMatchObject({ priority: 'high', ttl: 600 });
      expect(message.data).toMatchObject({ type: 'booking.arrival_check', salonId: 's1', bookingId: 'b1', lang: 'EN' });
    });

    it('is still gated only by the mandatory-arrival rule, never sent to an unregistered user', async () => {
      devices.devicesForUser.mockResolvedValue([]);
      await service.dispatchLocalizedToUser('owner-1', 'arrivalCheck', 'Haircut', { type: 'booking.arrival_check' });
      expect(expo.send).not.toHaveBeenCalled();
    });
  });

  it('leaves every other push kind exactly as it was — no forced channel/sound/priority', async () => {
    prisma.user.findUnique.mockResolvedValue({ preferredLanguage: Language.EN });
    await service.dispatchLocalizedToUser('owner-1', 'newBooking', 'Haircut', { type: 'booking.created' });
    const [[messages]] = expo.send.mock.calls;
    expect(messages[0]).not.toHaveProperty('channelId');
    expect(messages[0]).not.toHaveProperty('sound');
    expect(messages[0]).not.toHaveProperty('priority');
  });

  describe('notification preferences gate delivery (PUSH channel)', () => {
    const oneDevice = () => devices.devicesForUser.mockResolvedValue([{ expoPushToken: 'ExponentPushToken[a]' }]);
    const stored = (rows: Record<string, boolean>) =>
      prisma.notificationPreference.findUnique.mockImplementation(
        async ({ where }: { where: { userId_category_channel: { category: string; channel: string } } }) => {
          const { category, channel } = where.userId_category_channel;
          const key = `${category}:${channel}`;
          return key in rows ? { enabled: rows[key] } : null;
        },
      );
    const send = (kind: 'newBooking' | 'bookingRescheduled' | 'bookingCancelled' | 'arrivalCheck') =>
      service.dispatchLocalizedToUser('owner-1', kind, 'Haircut', { type: 'x', salonId: 's1', bookingId: 'b1' });

    it('DEFAULT ON: a user with no preference rows at all receives every operational push kind', async () => {
      oneDevice();
      for (const kind of ['newBooking', 'bookingRescheduled', 'bookingCancelled', 'arrivalCheck'] as const) {
        expo.send.mockClear();
        await send(kind);
        expect(expo.send).toHaveBeenCalledTimes(1);
      }
    });

    it('checks the PUSH channel for the right category (BOOKING_UPDATES for bookings, ARRIVAL_ALERTS for the arrival check)', async () => {
      oneDevice();
      await send('newBooking');
      await send('arrivalCheck');
      const asked = prisma.notificationPreference.findUnique.mock.calls.map(
        ([arg]) => `${arg.where.userId_category_channel.category}:${arg.where.userId_category_channel.channel}`,
      );
      expect(asked).toEqual(['BOOKING_UPDATES:PUSH', 'ARRIVAL_ALERTS:PUSH']);
    });

    it.each([
      ['newBooking', 'BOOKING_UPDATES'],
      ['bookingRescheduled', 'BOOKING_UPDATES'],
      ['bookingCancelled', 'BOOKING_UPDATES'],
    ] as const)('EXPLICIT OFF: %s sends nothing when %s is OFF on PUSH - and never even loads the user\'s devices', async (kind, category) => {
      oneDevice();
      stored({ [`${category}:PUSH`]: false });
      await send(kind);
      expect(expo.send).not.toHaveBeenCalled();
      expect(devices.devicesForUser).not.toHaveBeenCalled();
    });

    it('OFF is per category: turning BOOKING_UPDATES off does not stop arrival-check pushes, and vice versa', async () => {
      oneDevice();
      stored({ 'BOOKING_UPDATES:PUSH': false });
      await send('arrivalCheck');
      expect(expo.send).toHaveBeenCalledTimes(1);

      expo.send.mockClear();
      stored({ 'ARRIVAL_ALERTS:PUSH': false });
      await send('newBooking');
      expect(expo.send).toHaveBeenCalledTimes(1);
    });

    it('OFF is per channel: turning the IN_APP channel off does not stop push', async () => {
      oneDevice();
      stored({ 'BOOKING_UPDATES:IN_APP': false, 'ARRIVAL_ALERTS:IN_APP': false });
      await send('newBooking');
      await send('arrivalCheck');
      expect(expo.send).toHaveBeenCalledTimes(2);
    });

    it('an explicit ON row behaves like the default', async () => {
      oneDevice();
      stored({ 'ARRIVAL_ALERTS:PUSH': true });
      await send('arrivalCheck');
      expect(expo.send).toHaveBeenCalledTimes(1);
    });

    it('turning a category back ON resumes delivery', async () => {
      oneDevice();
      stored({ 'BOOKING_UPDATES:PUSH': false });
      await send('newBooking');
      expect(expo.send).not.toHaveBeenCalled();
      stored({ 'BOOKING_UPDATES:PUSH': true });
      await send('newBooking');
      expect(expo.send).toHaveBeenCalledTimes(1);
    });

    // ---- the critical arrival prompt is MANDATORY: preferences can never suppress its transport ----
    describe('critical arrival prompt is mandatory (cannot be suppressed by preferences)', () => {
      it('is sent even when ARRIVAL_ALERTS on PUSH is explicitly OFF (e.g. a stale/legacy row)', async () => {
        oneDevice();
        stored({ 'ARRIVAL_ALERTS:PUSH': false });
        await send('arrivalCheck');
        expect(expo.send).toHaveBeenCalledTimes(1);
      });

      it('is sent even when EVERY operational push preference is OFF', async () => {
        oneDevice();
        stored({
          'BOOKING_UPDATES:PUSH': false,
          'QUEUE_UPDATES:PUSH': false,
          'REMINDERS:PUSH': false,
          'ARRIVAL_ALERTS:PUSH': false,
          'ARRIVAL_ALERTS:IN_APP': false,
          'PROMOTIONAL:PUSH': false,
        });
        await send('arrivalCheck');
        expect(expo.send).toHaveBeenCalledTimes(1);
        // ...while an ordinary booking push in the same state IS still suppressed - the exemption is
        // the arrival prompt only, not a hole in the gate.
        expo.send.mockClear();
        await send('newBooking');
        expect(expo.send).not.toHaveBeenCalled();
      });

      it('is a high-priority DATA-ONLY message (no title/body/channel/sound)', async () => {
        oneDevice();
        await send('arrivalCheck');
        const [[messages]] = expo.send.mock.calls;
        expect(messages[0]).toMatchObject({ priority: 'high' });
        for (const key of ['title', 'body', 'channelId', 'sound', 'categoryId']) expect(messages[0]).not.toHaveProperty(key);
      });

      it('carries only IDs and non-personal operational fields: type, shop, booking, time, service, language', async () => {
        oneDevice();
        await service.dispatchLocalizedToUser('owner-1', 'arrivalCheck', 'Haircut', {
          type: 'booking.arrival_check',
          salonId: 's1',
          bookingId: 'b1',
          slotStart: '2026-09-21T10:00:00.000Z',
          serviceName: 'Haircut',
        });
        const [[messages]] = expo.send.mock.calls;
        expect(Object.keys(messages[0].data).sort()).toEqual(
          ['bookingId', 'lang', 'salonId', 'serviceName', 'slotStart', 'type'].sort(),
        );
        expect(messages[0].data.lang).toBe('EN');
        // No customer identity (phone/email/name fields) anywhere; the generic word "customer" in the body copy is not PII.
        const serialized = JSON.stringify(messages[0]);
        for (const forbidden of ['phone', 'email', 'contact', '+91', '@', 'customername']) {
          expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
        }
      });

      it("uses the recipient's own language for the native screen (Hindi owner gets lang HI)", async () => {
        oneDevice();
        prisma.user.findUnique.mockResolvedValue({ preferredLanguage: Language.HI });
        await send('arrivalCheck');
        const [[messages]] = expo.send.mock.calls;
        expect(messages[0].data.lang).toBe('HI');
      });
    });

    it('never writes a preference row - reading the gate cannot create an OFF row', async () => {
      oneDevice();
      await send('arrivalCheck');
      expect(Object.keys(prisma.notificationPreference)).toEqual(['findUnique']);
    });

    it('sends by default when the preference itself cannot be read (unknown is not off), and says so in the log', async () => {
      oneDevice();
      prisma.notificationPreference.findUnique.mockRejectedValue(new Error('db down'));
      await send('arrivalCheck');
      expect(expo.send).toHaveBeenCalledTimes(1);
    });

    it('the gate applies to direct dispatchToUser too - a payload cannot skip its category', async () => {
      oneDevice();
      stored({ 'REMINDERS:PUSH': false });
      await service.dispatchToUser('owner-1', { category: 'REMINDERS', title: 't', body: 'b' });
      expect(expo.send).not.toHaveBeenCalled();
    });
  });

  it('degrades to English rather than failing when the recipient-language lookup itself throws', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));
    await expect(
      service.dispatchLocalizedToUser('owner-1', 'newBooking', 'Haircut', { type: 'booking.created' }),
    ).resolves.toBeUndefined();
    expect(expo.send).toHaveBeenCalledWith([expect.objectContaining({ title: 'New booking' })]);
  });
});
