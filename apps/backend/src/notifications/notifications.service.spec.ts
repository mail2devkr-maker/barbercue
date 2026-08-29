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

  describe('getPreferences', () => {
    it('returns every category x channel combination, defaulting to enabled', async () => {
      const result = await service.getPreferences('user1');
      expect(result.categories).toHaveLength(4);
      for (const cat of result.categories) {
        expect(cat.channels).toHaveLength(5);
        expect(cat.channels.every((c) => c.enabled)).toBe(true);
      }
    });

    it('reports IN_APP as the only available channel', async () => {
      const result = await service.getPreferences('user1');
      const bookingUpdates = result.categories.find(
        (c) => c.category === 'BOOKING_UPDATES',
      )!;
      const byChannel = Object.fromEntries(
        bookingUpdates.channels.map((c) => [c.channel, c.available]),
      );
      expect(byChannel).toEqual({
        IN_APP: true,
        PUSH: false,
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
