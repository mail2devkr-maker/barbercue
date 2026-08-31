import { Test } from '@nestjs/testing';
import { PushDeliveryService } from './push-delivery.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PUSH_SENDER,
  type PushMessage,
  type PushReceiptResult,
  type PushSender,
  type PushSendResult,
} from './push-sender';

class TestPushSender implements PushSender {
  configured = true;
  sendResults: PushSendResult[] = [];
  messages: PushMessage[] = [];
  receipts: PushReceiptResult[] = [];

  async sendBatch(messages: PushMessage[]): Promise<PushSendResult[]> {
    this.messages.push(...messages);
    return this.sendResults;
  }

  async getReceipts(): Promise<PushReceiptResult[]> {
    return this.receipts;
  }
}

function pushRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notification-1',
    type: 'booking.confirmed',
    payload: { salonName: 'Handsome Center', serviceName: 'Haircut' },
    pushDeviceId: 'device-1',
    pushDevice: { pushToken: 'ExpoPushToken[valid_1]', enabled: true },
    ...overrides,
  };
}

describe('PushDeliveryService', () => {
  let service: PushDeliveryService;
  let sender: TestPushSender;
  let prisma: {
    notification: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    pushDevice: { updateMany: jest.Mock };
  };

  beforeEach(async () => {
    sender = new TestPushSender();
    prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([{ id: 'notification-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn((args: { include?: unknown }) =>
          args.include
            ? Promise.resolve(pushRow())
            : Promise.resolve({ deliveryAttempts: 1 }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      pushDevice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushDeliveryService,
        { provide: PrismaService, useValue: prisma },
        { provide: PUSH_SENDER, useValue: sender },
      ],
    }).compile();
    service = moduleRef.get(PushDeliveryService);
  });

  it('claims and sends a durable pending row', async () => {
    sender.sendResults = [
      {
        notificationId: 'notification-1',
        ok: true,
        providerMessageId: 'ticket-1',
      },
    ];
    await expect(service.dispatchPending()).resolves.toBe(1);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'notification-1',
          status: 'PENDING',
        }),
        data: {
          deliveryClaimedAt: expect.any(Date),
          deliveryAttempts: { increment: 1 },
        },
      }),
    );
    expect(sender.messages).toHaveLength(1);
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SENT',
          providerMessageId: 'ticket-1',
        }),
      }),
    );
  });

  it('skips a disabled device without contacting the provider', async () => {
    prisma.notification.findUnique.mockResolvedValueOnce(
      pushRow({
        pushDevice: { pushToken: 'ExpoPushToken[x]', enabled: false },
      }),
    );
    await expect(service.dispatchPending()).resolves.toBe(0);
    expect(sender.messages).toHaveLength(0);
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureCode: 'DEVICE_DISABLED',
        }),
      }),
    );
  });

  it('disables an invalid/unregistered token', async () => {
    sender.sendResults = [
      {
        notificationId: 'notification-1',
        ok: false,
        errorCode: 'DeviceNotRegistered',
        invalidToken: true,
      },
    ];
    await service.dispatchPending();
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith({
      where: { id: 'device-1' },
      data: { enabled: false },
    });
  });

  it('retains a valid token and schedules retry after temporary provider failure', async () => {
    sender.sendResults = [
      {
        notificationId: 'notification-1',
        ok: false,
        errorCode: 'EXPO_TRANSPORT_ERROR',
        transient: true,
      },
    ];
    await service.dispatchPending();
    expect(prisma.pushDevice.updateMany).not.toHaveBeenCalled();
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryClaimedAt: null,
          nextDeliveryAttemptAt: expect.any(Date),
          failureCode: 'EXPO_TRANSPORT_ERROR',
        }),
      }),
    );
  });

  it('fan-out messages are independent per device row', async () => {
    prisma.notification.findMany.mockResolvedValueOnce([
      { id: 'notification-1' },
      { id: 'notification-2' },
    ]);
    prisma.notification.findUnique
      .mockResolvedValueOnce(pushRow())
      .mockResolvedValueOnce(
        pushRow({
          id: 'notification-2',
          pushDeviceId: 'device-2',
          pushDevice: { pushToken: 'ExpoPushToken[valid_2]', enabled: true },
        }),
      );
    sender.sendResults = [
      {
        notificationId: 'notification-1',
        ok: true,
        providerMessageId: 'ticket-1',
      },
      {
        notificationId: 'notification-2',
        ok: true,
        providerMessageId: 'ticket-2',
      },
    ];
    await expect(service.dispatchPending()).resolves.toBe(2);
    expect(sender.messages.map((message) => message.token)).toEqual([
      'ExpoPushToken[valid_1]',
      'ExpoPushToken[valid_2]',
    ]);
  });
});
