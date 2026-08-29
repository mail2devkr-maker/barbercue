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
  };

  beforeEach(async () => {
    prisma = {
      notification: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
      await service.notify('user1', 'booking.confirmed', { salonName: 'Demo' }, 'bookings/b1');
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
      await service.notify('user1', 'queue.turn_approaching', { salonId: 's1' });
      const call = prisma.notification.create.mock.calls[0][0] as { data: { deepLink: unknown } };
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
      const rows = Array.from({ length: 3 }, (_, i) => makeRow({ id: `n${i}` }));
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
    it('only touches this user\'s unread IN_APP notifications', async () => {
      await service.markAllRead('user1');
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user1', channel: 'IN_APP', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });
});
