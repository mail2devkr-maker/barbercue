import { Test } from '@nestjs/testing';
import { PushDevicesService } from './push-devices.service';
import { PrismaService } from '../prisma/prisma.service';

const input = {
  platform: 'ANDROID',
  provider: 'EXPO',
  pushToken: 'ExpoPushToken[abc_123]',
  installationId: 'installation-123',
} as const;

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'device-1',
    userId: 'user-1',
    ...input,
    enabled: true,
    lastSeenAt: new Date('2026-08-30T12:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PushDevicesService', () => {
  let service: PushDevicesService;
  let tx: {
    pushDevice: {
      findUnique: jest.Mock;
      update: jest.Mock;
      upsert: jest.Mock;
    };
  };
  let prisma: {
    $transaction: jest.Mock;
    pushDevice: { updateMany: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      pushDevice: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue(row()),
      },
    };
    prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
      pushDevice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushDevicesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(PushDevicesService);
  });

  it('derives ownership from the authenticated user argument', async () => {
    await service.register('user-1', input);
    expect(tx.pushDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: 'user-1' }),
        update: expect.objectContaining({ userId: 'user-1' }),
      }),
    );
  });

  it('updates an existing installation instead of creating a duplicate', async () => {
    tx.pushDevice.findUnique
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row());
    await service.register('user-1', input);
    expect(tx.pushDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_installationId: {
            provider: 'EXPO',
            installationId: input.installationId,
          },
        },
      }),
    );
    expect(tx.pushDevice.update).not.toHaveBeenCalled();
  });

  it('retires a token attached to a stale installation before reassignment', async () => {
    tx.pushDevice.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row({ id: 'stale-device', userId: 'old-user' }));
    await service.register('new-user', input);
    expect(tx.pushDevice.update).toHaveBeenCalledWith({
      where: { id: 'stale-device' },
      data: {
        enabled: false,
        pushToken: expect.stringMatching(/^retired:stale-device:/),
      },
    });
    expect(tx.pushDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: 'new-user' }),
      }),
    );
  });

  it('unregisters only the caller-owned installation', async () => {
    await service.unregister('user-1', {
      provider: 'EXPO',
      installationId: input.installationId,
    });
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        provider: 'EXPO',
        installationId: input.installationId,
      },
      data: { enabled: false, lastSeenAt: expect.any(Date) },
    });
  });
});
