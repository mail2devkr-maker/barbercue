import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    type: 'booking.confirmed',
    payload: { salonName: 'Demo Salon' },
    deepLink: 'bookings/b1',
    readAt: null,
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    ...overrides,
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    notificationPreference: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      notification: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      notificationPreference: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  describe('notify', () => {
    it('creates an IN_APP notification that starts unread and already SENT', async () => {
      const created = await service.notify(
        'user1',
        'booking.confirmed',
        { salonName: 'Demo' },
        'bookings/b1',
      );
      expect(created).toBe(true);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user1',
          channel: 'IN_APP',
          type: 'booking.confirmed',
          payload: { salonName: 'Demo' },
          status: 'SENT',
          sentAt: expect.any(Date),
          deepLink: 'bookings/b1',
        },
      });
    });

    it('stores a null deepLink when none is given', async () => {
      await service.notify('user1', 'queue.turn_approaching', {
        salonId: 's1',
      });
      const call = prisma.notification.create.mock.calls[0][0] as {
        data: { deepLink: unknown };
      };
      expect(call.data.deepLink).toBeNull();
    });
  });

  describe('listMine', () => {
    it('scopes to this user and the IN_APP channel only', async () => {
      await service.listMine('user1', undefined, 20);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user1', channel: 'IN_APP' },
        }),
      );
    });

    it('trims to the page size and sets nextCursor when there are more results', async () => {
      const rows = Array.from({ length: 3 }, (_, i) =>
        makeRow({ id: `n${i}` }),
      );
      prisma.notification.findMany.mockResolvedValueOnce(rows);
      const result = await service.listMine('user1', undefined, 2);
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('n1');
    });

    it('maps a row to a NotificationDto with ISO timestamps', async () => {
      prisma.notification.findMany.mockResolvedValueOnce([makeRow()]);
      const result = await service.listMine('user1', undefined, 20);
      expect(result.items[0]).toEqual({
        id: 'n1',
        type: 'booking.confirmed',
        payload: { salonName: 'Demo Salon' },
        deepLink: 'bookings/b1',
        readAt: null,
        createdAt: '2026-06-01T10:00:00.000Z',
      });
    });
  });

  describe('unreadCount', () => {
    it('counts only unread IN_APP notifications for this user', async () => {
      await service.unreadCount('user1');
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user1', channel: 'IN_APP', readAt: null },
      });
    });
  });

  describe('markRead', () => {
    it('scopes the update by userId, not just the notification id', async () => {
      await service.markRead('user1', 'n1');
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'user1', channel: 'IN_APP' },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('markAllRead', () => {
    it("only touches this user's unread IN_APP notifications", async () => {
      await service.markAllRead('user1');
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user1', channel: 'IN_APP', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('notify — preference gating (Phase 13)', () => {
    it('creates the notification when no preference row exists (default enabled)', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValueOnce(null);
      await service.notify('user1', 'booking.confirmed');
      expect(prisma.notification.create).toHaveBeenCalled();
    });

    it('skips creating the notification when the user has explicitly disabled this category/channel', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValueOnce({
        enabled: false,
      });
      const created = await service.notify('user1', 'booking.confirmed');
      expect(created).toBe(false);
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('maps queue.turn_approaching to the QUEUE_UPDATES category when checking preferences', async () => {
      await service.notify('user1', 'queue.turn_approaching');
      expect(prisma.notificationPreference.findUnique).toHaveBeenCalledWith({
        where: {
          userId_category_channel: {
            userId: 'user1',
            category: 'QUEUE_UPDATES',
            channel: 'IN_APP',
          },
        },
      });
    });
  });

  describe('notifyInTransaction', () => {
    it('uses the supplied transaction for both preference gating and notification creation', async () => {
      const tx = {
        notificationPreference: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        notification: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      const created = await service.notifyInTransaction(
        tx as never,
        'user1',
        'booking.reminder',
        { bookingId: 'b1' },
        'account/bookings',
      );

      expect(created).toBe(true);
      expect(tx.notificationPreference.findUnique).toHaveBeenCalled();
      expect(tx.notification.create).toHaveBeenCalled();
      expect(prisma.notificationPreference.findUnique).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('preferences: default ON and explicit OFF (IN_APP delivery)', () => {
    const TYPES_BY_CATEGORY: Array<[string, string]> = [
      ['booking.confirmed', 'BOOKING_UPDATES'],
      ['owner.booking.created', 'BOOKING_UPDATES'],
      ['owner.booking.no_show', 'BOOKING_UPDATES'],
      ['queue.turn_approaching', 'QUEUE_UPDATES'],
      ['owner.walk_in.joined', 'QUEUE_UPDATES'],
      ['owner.booking.arrival_check', 'ARRIVAL_ALERTS'],
      ['booking.reminder', 'REMINDERS'],
    ];
    const stored = (rows: Record<string, boolean>) =>
      prisma.notificationPreference.findUnique.mockImplementation(
        async ({ where }: { where: { userId_category_channel: { category: string; channel: string } } }) => {
          const { category, channel } = where.userId_category_channel;
          const key = `${category}:${channel}`;
          return key in rows ? { enabled: rows[key] } : null;
        },
      );

    it.each(TYPES_BY_CATEGORY)('DEFAULT ON: %s (%s) is delivered to a user who never configured anything', async (type) => {
      // no preference rows exist for this user
      const delivered = await service.notify('user-with-no-rows', type as never);
      expect(delivered).toBe(true);
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    });

    it.each(TYPES_BY_CATEGORY)('EXPLICIT OFF: %s is NOT delivered when %s is OFF on IN_APP', async (type, category) => {
      stored({ [`${category}:IN_APP`]: false });
      const delivered = await service.notify('user1', type as never);
      expect(delivered).toBe(false);
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('the arrival check is governed by ARRIVAL_ALERTS, not BOOKING_UPDATES', async () => {
      stored({ 'BOOKING_UPDATES:IN_APP': false });
      expect(await service.notify('user1', 'owner.booking.arrival_check')).toBe(true);
      prisma.notification.create.mockClear();
      stored({ 'ARRIVAL_ALERTS:IN_APP': false });
      expect(await service.notify('user1', 'owner.booking.arrival_check')).toBe(false);
      expect(await service.notify('user1', 'owner.booking.created')).toBe(true); // bookings unaffected
    });

    it('OFF is per category: queue updates off leaves booking updates and reminders flowing', async () => {
      stored({ 'QUEUE_UPDATES:IN_APP': false });
      expect(await service.notify('user1', 'owner.walk_in.joined')).toBe(false);
      expect(await service.notify('user1', 'booking.confirmed')).toBe(true);
      expect(await service.notify('user1', 'booking.reminder')).toBe(true);
    });

    it('OFF is per channel: a PUSH-off preference never suppresses the in-app notification', async () => {
      stored({ 'BOOKING_UPDATES:PUSH': false, 'ARRIVAL_ALERTS:PUSH': false });
      expect(await service.notify('user1', 'owner.booking.created')).toBe(true);
      expect(await service.notify('user1', 'owner.booking.arrival_check')).toBe(true);
    });

    it('promotional is a separate toggle: promotional off changes nothing operational, and operational off changes nothing promotional', async () => {
      stored({ 'PROMOTIONAL:IN_APP': false });
      expect(await service.notify('user1', 'booking.confirmed')).toBe(true);
      expect(await service.notify('user1', 'owner.booking.arrival_check')).toBe(true);
      const prefs = await (async () => {
        prisma.notificationPreference.findMany.mockResolvedValueOnce([
          { category: 'BOOKING_UPDATES', channel: 'IN_APP', enabled: false },
        ]);
        return service.getPreferences('user1');
      })();
      const promo = prefs.categories.find((c) => c.category === 'PROMOTIONAL')!;
      expect(promo.channels.find((c) => c.channel === 'IN_APP')!.enabled).toBe(true);
    });

    it('an explicit ON row behaves like the default, and turning a category back ON resumes delivery', async () => {
      stored({ 'ARRIVAL_ALERTS:IN_APP': false });
      expect(await service.notify('user1', 'owner.booking.arrival_check')).toBe(false);
      stored({ 'ARRIVAL_ALERTS:IN_APP': true });
      expect(await service.notify('user1', 'owner.booking.arrival_check')).toBe(true);
    });

    it('the gate is applied inside notifyInTransaction too, on the transaction client', async () => {
      const txFindUnique = jest.fn().mockResolvedValue({ enabled: false });
      const tx = { notificationPreference: { findUnique: txFindUnique }, notification: { create: jest.fn() } };
      const delivered = await service.notifyInTransaction(tx as never, 'user1', 'owner.booking.arrival_check');
      expect(delivered).toBe(false);
      expect(tx.notification.create).not.toHaveBeenCalled();
      expect(txFindUnique).toHaveBeenCalledWith({
        where: { userId_category_channel: { userId: 'user1', category: 'ARRIVAL_ALERTS', channel: 'IN_APP' } },
      });
    });

    it('reading preferences NEVER writes a row: an unconfigured user is not silently given OFF (or any) rows', async () => {
      await service.getPreferences('user-with-no-rows');
      await service.notify('user-with-no-rows', 'owner.booking.arrival_check');
      expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getPreferences: every category is ON for a user who never configured anything', () => {
    it('reports all five categories ON on every channel when there are no rows', async () => {
      const result = await service.getPreferences('user-with-no-rows');
      expect(result.categories.map((c) => c.category)).toEqual([
        'BOOKING_UPDATES',
        'QUEUE_UPDATES',
        'ARRIVAL_ALERTS',
        'REMINDERS',
        'PROMOTIONAL',
      ]);
      for (const category of result.categories) {
        for (const channel of category.channels) expect(channel.enabled).toBe(true);
      }
    });

    it('operational categories come before promotional, which stays its own separate entry', async () => {
      const result = await service.getPreferences('user1');
      const order = result.categories.map((c) => c.category);
      expect(order.indexOf('PROMOTIONAL')).toBe(order.length - 1);
      expect(order.slice(0, -1)).not.toContain('PROMOTIONAL');
    });

    it('reflects only the explicit change: one OFF row turns exactly that category+channel OFF', async () => {
      prisma.notificationPreference.findMany.mockResolvedValueOnce([
        { category: 'ARRIVAL_ALERTS', channel: 'PUSH', enabled: false },
      ]);
      const result = await service.getPreferences('user1');
      const flat = result.categories.flatMap((c) => c.channels.map((ch) => [`${c.category}:${ch.channel}`, ch.enabled] as const));
      const off = flat.filter(([, enabled]) => !enabled).map(([key]) => key);
      expect(off).toEqual(['ARRIVAL_ALERTS:PUSH']);
    });
  });

  describe('getPreferences', () => {
    it('returns every category x channel combination, defaulting to enabled', async () => {
      const result = await service.getPreferences('user1');
      expect(result.categories).toHaveLength(5);
      for (const cat of result.categories) {
        expect(cat.channels).toHaveLength(5);
        expect(cat.channels.every((c) => c.enabled)).toBe(true);
      }
    });

    it('reports IN_APP and PUSH as the available channels (the two FastQue really delivers on)', async () => {
      const result = await service.getPreferences('user1');
      const bookingUpdates = result.categories.find(
        (c) => c.category === 'BOOKING_UPDATES',
      )!;
      const byChannel = Object.fromEntries(
        bookingUpdates.channels.map((c) => [c.channel, c.available]),
      );
      expect(byChannel).toEqual({
        IN_APP: true,
        PUSH: true,
        EMAIL: false,
        SMS: false,
        WHATSAPP: false,
      });
    });

    it('reflects a stored disabled preference', async () => {
      prisma.notificationPreference.findMany.mockResolvedValueOnce([
        { category: 'PROMOTIONAL', channel: 'IN_APP', enabled: false },
      ]);
      const result = await service.getPreferences('user1');
      const promo = result.categories.find(
        (c) => c.category === 'PROMOTIONAL',
      )!;
      const inApp = promo.channels.find((c) => c.channel === 'IN_APP')!;
      expect(inApp.enabled).toBe(false);
    });
  });

  describe('setPreference', () => {
    it('upserts the preference scoped to this user', async () => {
      await service.setPreference('user1', 'PROMOTIONAL', 'IN_APP', false);
      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: {
          userId_category_channel: {
            userId: 'user1',
            category: 'PROMOTIONAL',
            channel: 'IN_APP',
          },
        },
        update: { enabled: false },
        create: {
          userId: 'user1',
          category: 'PROMOTIONAL',
          channel: 'IN_APP',
          enabled: false,
        },
      });
    });

    it('returns the full updated preferences list', async () => {
      const result = await service.setPreference(
        'user1',
        'PROMOTIONAL',
        'IN_APP',
        false,
      );
      expect(result.categories).toHaveLength(5);
    });
  });

  // Persistence round trip against a small in-memory stand-in for the preference table: what a
  // user sets is exactly what a later read shows AND what delivery then honours.
  describe('setPreference -> getPreferences -> delivery round trip', () => {
    beforeEach(() => {
      const table = new Map<string, boolean>();
      const keyOf = (w: { category: string; channel: string }) => `${w.category}:${w.channel}`;
      prisma.notificationPreference.upsert.mockImplementation(
        async ({ where, create }: { where: { userId_category_channel: { category: string; channel: string } }; create: { enabled: boolean } }) => {
          table.set(keyOf(where.userId_category_channel), create.enabled);
          return {};
        },
      );
      prisma.notificationPreference.findMany.mockImplementation(async () =>
        [...table.entries()].map(([k, enabled]) => {
          const [category, channel] = k.split(':');
          return { category, channel, enabled };
        }),
      );
      prisma.notificationPreference.findUnique.mockImplementation(
        async ({ where }: { where: { userId_category_channel: { category: string; channel: string } } }) => {
          const key = keyOf(where.userId_category_channel);
          return table.has(key) ? { enabled: table.get(key) } : null;
        },
      );
    });

    const flag = (
      prefs: Awaited<ReturnType<NotificationsService['getPreferences']>>,
      category: string,
      channel: string,
    ) => prefs.categories.find((c) => c.category === category)!.channels.find((c) => c.channel === channel)!.enabled;

    it('an OFF choice persists and reloads OFF, touching nothing else, and stops that category+channel', async () => {
      const before = await service.getPreferences('u1');
      expect(flag(before, 'ARRIVAL_ALERTS', 'PUSH')).toBe(true);

      const after = await service.setPreference('u1', 'ARRIVAL_ALERTS', 'PUSH', false);
      expect(flag(after, 'ARRIVAL_ALERTS', 'PUSH')).toBe(false);

      const reloaded = await service.getPreferences('u1'); // a fresh read, as after an app restart
      expect(flag(reloaded, 'ARRIVAL_ALERTS', 'PUSH')).toBe(false);
      expect(flag(reloaded, 'ARRIVAL_ALERTS', 'IN_APP')).toBe(true);
      expect(flag(reloaded, 'BOOKING_UPDATES', 'PUSH')).toBe(true);
      expect(flag(reloaded, 'PROMOTIONAL', 'PUSH')).toBe(true);

      // IN_APP for the same category still delivers - PUSH-off is per channel.
      expect(await service.notify('u1', 'owner.booking.arrival_check')).toBe(true);
    });

    it('turning it back ON persists and reloads ON', async () => {
      await service.setPreference('u1', 'QUEUE_UPDATES', 'IN_APP', false);
      expect(await service.notify('u1', 'owner.walk_in.joined')).toBe(false);
      await service.setPreference('u1', 'QUEUE_UPDATES', 'IN_APP', true);
      expect(flag(await service.getPreferences('u1'), 'QUEUE_UPDATES', 'IN_APP')).toBe(true);
      expect(await service.notify('u1', 'owner.walk_in.joined')).toBe(true);
    });
  });
});
