import { Prisma } from '@prisma/client';
import { NotificationCategory } from '@barbercue/shared';
import {
  NotificationDeliveryService,
  PUSH_MAX_ATTEMPTS,
  PUSH_RETRY_BACKOFF_SECONDS,
} from './notification-delivery.service';

type Row = Record<string, unknown> & { dedupeKey: string; id: string };

/** A tiny in-memory stand-in for the notification_deliveries table (unique dedupeKey). */
function fakePrisma() {
  const rows = new Map<string, Row>();
  let seq = 0;
  const notificationDelivery = {
    findUnique: jest.fn(async ({ where }: { where: { dedupeKey: string } }) => rows.get(where.dedupeKey) ?? null),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const key = data.dedupeKey as string;
      if (rows.has(key)) {
        throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
      }
      const row = { id: `d${++seq}`, ...data } as Row;
      rows.set(key, row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: { where: { dedupeKey: string }; data: Record<string, unknown> }) => {
      const row = rows.get(where.dedupeKey)!;
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = [...rows.values()].find((r) => r.id === where.id);
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    findMany: jest.fn(async () => [...rows.values()].filter((r) => ['PENDING', 'FAILED'].includes(r.status as string))),
    findFirst: jest.fn(async () => null),
  };
  const prisma = {
    notificationDelivery,
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ notificationDelivery })),
  };
  return { prisma, rows };
}

const INPUT = {
  dedupeKey: 'booking.cancelled_by_shop:b1',
  userId: 'u1',
  type: 'booking.cancelled_by_shop' as const,
  inAppPayload: { bookingId: 'b1' },
  deepLink: 'account/bookings',
  push: { title: 'T', body: 'B', data: { bookingId: 'b1' }, category: NotificationCategory.BOOKING_UPDATES },
};

describe('NotificationDeliveryService', () => {
  function build(overrides: { notifyCreated?: boolean; pushAllowed?: boolean; send?: jest.Mock } = {}) {
    const { prisma, rows } = fakePrisma();
    const notifications = { notifyInTransaction: jest.fn(async () => overrides.notifyCreated ?? true) };
    const push = {
      isPushAllowed: jest.fn(async () => overrides.pushAllowed ?? true),
      sendToUser:
        overrides.send ?? jest.fn(async () => ({ attempted: 1, delivered: 1, noDevices: false, transientFailure: false, error: null })),
    };
    const service = new NotificationDeliveryService(prisma as never, notifications as never, push as never);
    return { service, rows, notifications, push, prisma };
  }

  it('delivers in-app and push once, and records both as SENT', async () => {
    const { service, rows, notifications, push } = build();
    expect(await service.deliverToUser(INPUT)).toEqual({ inApp: 'SENT', push: 'SENT' });
    expect(notifications.notifyInTransaction).toHaveBeenCalledTimes(1);
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(rows.get('booking.cancelled_by_shop:b1:IN_APP')).toMatchObject({ status: 'SENT' });
    expect(rows.get('booking.cancelled_by_shop:b1:PUSH')).toMatchObject({ status: 'SENT', attempts: 1, nextAttemptAt: null });
  });

  it('a repeated identical event neither re-notifies nor re-sends', async () => {
    const { service, notifications, push } = build();
    await service.deliverToUser(INPUT);
    expect(await service.deliverToUser(INPUT)).toEqual({ inApp: 'SENT', push: 'SENT' });
    expect(notifications.notifyInTransaction).toHaveBeenCalledTimes(1);
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('reports "no device" and a disabled preference as skips, never as sent', async () => {
    const none = build({ send: jest.fn(async () => ({ attempted: 0, delivered: 0, noDevices: true, transientFailure: false, error: null })) });
    expect((await none.service.deliverToUser(INPUT)).push).toBe('NO_DEVICE');
    expect(none.rows.get('booking.cancelled_by_shop:b1:PUSH')).toMatchObject({ status: 'SKIPPED', lastError: 'NO_DEVICE' });

    const off = build({ pushAllowed: false, notifyCreated: false });
    const outcome = await off.service.deliverToUser(INPUT);
    expect(outcome).toEqual({ inApp: 'SKIPPED', push: 'SKIPPED' });
    expect(off.push.sendToUser).not.toHaveBeenCalled();
  });

  it('retries a transient failure with exponential backoff, then gives up after the maximum attempts', async () => {
    const send = jest.fn(async () => ({ attempted: 1, delivered: 0, noDevices: false, transientFailure: true, error: 'provider down' }));
    const { service, rows } = build({ send });
    expect((await service.deliverToUser(INPUT)).push).toBe('FAILED');
    const row = () => rows.get('booking.cancelled_by_shop:b1:PUSH')!;
    expect(row()).toMatchObject({ status: 'FAILED', attempts: 1 });
    const firstDue = (row().nextAttemptAt as Date).getTime();
    expect(firstDue - Date.now()).toBeGreaterThan((PUSH_RETRY_BACKOFF_SECONDS[0] - 5) * 1000);

    let now = new Date(Date.now() + 24 * 3_600_000);
    for (let attempt = 2; attempt <= PUSH_MAX_ATTEMPTS; attempt++) {
      expect(await service.sweepRetries(now)).toBe(1);
      expect(row().attempts).toBe(attempt);
      now = new Date(now.getTime() + 24 * 3_600_000);
    }
    expect(row()).toMatchObject({ status: 'GAVE_UP', attempts: PUSH_MAX_ATTEMPTS, nextAttemptAt: null });
    expect(await service.sweepRetries(now)).toBe(0); // nothing left to retry
    expect(send).toHaveBeenCalledTimes(PUSH_MAX_ATTEMPTS);
  });

  it('does not retry a push the provider answered and rejected outright', async () => {
    const send = jest.fn(async () => ({ attempted: 1, delivered: 0, noDevices: false, transientFailure: false, error: 'DeviceNotRegistered' }));
    const { service, rows } = build({ send });
    expect((await service.deliverToUser(INPUT)).push).toBe('GAVE_UP');
    expect(rows.get('booking.cancelled_by_shop:b1:PUSH')).toMatchObject({ status: 'GAVE_UP', lastError: 'DeviceNotRegistered' });
  });

  it('a retried delivery succeeds once the provider recovers', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ attempted: 1, delivered: 0, noDevices: false, transientFailure: true, error: 'down' })
      .mockResolvedValueOnce({ attempted: 1, delivered: 1, noDevices: false, transientFailure: false, error: null });
    const { service, rows } = build({ send });
    await service.deliverToUser(INPUT);
    await service.sweepRetries(new Date(Date.now() + 3_600_000));
    expect(rows.get('booking.cancelled_by_shop:b1:PUSH')).toMatchObject({ status: 'SENT', attempts: 2 });
  });
});
