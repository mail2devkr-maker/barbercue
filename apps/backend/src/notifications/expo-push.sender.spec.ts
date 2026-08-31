import { ExpoPushSender } from './expo-push.sender';
import type { PushMessage } from './push-sender';

const message: PushMessage = {
  notificationId: 'notification-1',
  token: 'ExpoPushToken[abc_123]',
  title: 'Booking confirmed',
  body: 'Haircut at Demo Salon',
  data: {
    type: 'booking.confirmed',
    screen: 'CUSTOMER_BOOKING',
    bookingId: 'booking-1',
  },
};

describe('ExpoPushSender', () => {
  const previousProvider = process.env.PUSH_PROVIDER;

  beforeEach(() => {
    process.env.PUSH_PROVIDER = 'expo';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousProvider === undefined) delete process.env.PUSH_PROVIDER;
    else process.env.PUSH_PROVIDER = previousProvider;
  });

  it('maps a successful Expo ticket to the durable notification row', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: 'ok', id: 'ticket-1' }] }),
    } as Response);

    await expect(new ExpoPushSender().sendBatch([message])).resolves.toEqual([
      {
        notificationId: 'notification-1',
        ok: true,
        providerMessageId: 'ticket-1',
      },
    ]);
  });

  it('treats a missing ticket as transient so the outbox retries it', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);

    await expect(new ExpoPushSender().sendBatch([message])).resolves.toEqual([
      {
        notificationId: 'notification-1',
        ok: false,
        errorCode: 'EXPO_TICKET_MISSING',
        transient: true,
      },
    ]);
  });

  it('classifies DeviceNotRegistered so only the invalid device is disabled', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
      }),
    } as Response);

    await expect(new ExpoPushSender().sendBatch([message])).resolves.toEqual([
      {
        notificationId: 'notification-1',
        ok: false,
        errorCode: 'DeviceNotRegistered',
        invalidToken: true,
        transient: false,
      },
    ]);
  });
});
