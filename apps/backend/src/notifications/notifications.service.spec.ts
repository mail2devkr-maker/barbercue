import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import {
  BOOKING_VISIT_NOTIFICATION_TYPES,
  NotificationsService,
  QUEUE_VISIT_NOTIFICATION_TYPES,
} from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

/** The SQL text and bound values of a $queryRaw call (Prisma.Sql). */
function rawSql(call: unknown): { text: string; values: unknown[] } {
  const sql = call as Prisma.Sql;
  return { text: sql.sql, values: sql.values };
}

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
      findFirst: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    $queryRaw: jest.Mock;
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
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
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
    it('scopes to this user and the IN_APP channel only, newest first, one extra row to detect more', async () => {
      await service.listMine('user1', undefined, 20);
      const { text, values } = rawSql(prisma.$queryRaw.mock.calls[0][0]);
      expect(text).toContain('n."userId" =');
      expect(text).toContain('n."channel"::text =');
      expect(text).toContain('ORDER BY n."createdAt" DESC, n."id" DESC');
      expect(values).toEqual(expect.arrayContaining(['user1', 'IN_APP', 21]));
    });

    it('leaves out visit notices whose queue visit or booking is over (auto-expiry)', async () => {
      await service.listMine('user1', undefined, 20);
      const { text, values } = rawSql(prisma.$queryRaw.mock.calls[0][0]);
      expect(text).toContain('"queue_entries" q');
      expect(text).toContain("q.\"status\"::text IN ('COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED')");
      expect(text).toContain('"bookings" b');
      expect(text).toContain("b.\"slotEnd\" <= (NOW() AT TIME ZONE 'UTC')");
      expect(values).toEqual(
        expect.arrayContaining([
          ...QUEUE_VISIT_NOTIFICATION_TYPES,
          ...BOOKING_VISIT_NOTIFICATION_TYPES,
        ]),
      );
      // Outcome notices written after a visit are never retired.
      for (const kept of ['booking.no_show', 'booking.expired', 'booking.corrected', 'owner.inventory.reorder']) {
        expect(values).not.toContain(kept);
      }
    });

    it('trims to the page size and sets nextCursor when there are more results', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'n0' }, { id: 'n1' }, { id: 'n2' }]);
      prisma.notification.findMany.mockResolvedValueOnce([
        makeRow({ id: 'n1' }),
        makeRow({ id: 'n0' }),
      ]);
      const result = await service.listMine('user1', undefined, 2);
      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['n0', 'n1'] } },
      });
      // Order follows the SQL page, not the order rows came back in.
      expect(result.items.map((i) => i.id)).toEqual(['n0', 'n1']);
      expect(result.nextCursor).toBe('n1');
    });

    it('continues after the cursor row of this user, and returns an empty page for an unknown cursor', async () => {
      prisma.notification.findFirst.mockResolvedValueOnce({ id: 'n5' });
      await service.listMine('user1', 'n5', 20);
      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'n5', userId: 'user1', channel: 'IN_APP' },
        select: { id: true },
      });
      const { text, values } = rawSql(prisma.$queryRaw.mock.calls[0][0]);
      expect(text).toContain('(n."createdAt", n."id") <');
      expect(values).toContain('n5');

      prisma.$queryRaw.mockClear();
      prisma.notification.findFirst.mockResolvedValueOnce(null);
      await expect(service.listMine('user1', 'someone-elses', 20)).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('maps a row to a NotificationDto with ISO timestamps', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'n1' }]);
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
    it('counts only unread, still-current IN_APP notifications for this user', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ count: 4 }]);
      await expect(service.unreadCount('user1')).resolves.toBe(4);
      const { text, values } = rawSql(prisma.$queryRaw.mock.calls[0][0]);
      expect(text).toContain('n."readAt" IS NULL');
      expect(text).toContain('"queue_entries" q');
      expect(text).toContain('"bookings" b');
      expect(values).toEqual(expect.arrayContaining(['user1', 'IN_APP']));
    });

    it('is 0 when nothing is unread', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ count: 0 }]);
      await expect(service.unreadCount('user1')).resolves.toBe(0);
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

  describe('getPreferences', () => {
    it('returns every category x channel combination, defaulting to enabled', async () => {
      const result = await service.getPreferences('user1');
      expect(result.categories).toHaveLength(4);
      for (const cat of result.categories) {
        expect(cat.channels).toHaveLength(5);
        expect(cat.channels.every((c) => c.enabled)).toBe(true);
      }
    });

    it('reports native PUSH and IN_APP as available channels', async () => {
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
      expect(result.categories).toHaveLength(4);
    });
  });
});
