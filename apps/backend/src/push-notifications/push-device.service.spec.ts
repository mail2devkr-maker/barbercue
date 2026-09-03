import { Test } from '@nestjs/testing';
import { PushDeviceService } from './push-device.service';
import { PrismaService } from '../prisma/prisma.service';

const VALID_TOKEN = 'ExponentPushToken[abc123DEF456]';

describe('PushDeviceService', () => {
  let service: PushDeviceService;
  let prisma: {
    pushDevice: {
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      pushDevice: {
        upsert: jest.fn().mockResolvedValue({ id: 'd1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushDeviceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(PushDeviceService);
  });

  describe('register', () => {
    it('rejects a token that does not look like a real Expo push token', async () => {
      await expect(
        service.register('u1', 'not-a-real-token', undefined),
      ).rejects.toThrow();
      expect(prisma.pushDevice.upsert).not.toHaveBeenCalled();
    });

    it('accepts both historical Expo token prefixes', async () => {
      await service.register('u1', 'ExponentPushToken[abc]', undefined);
      await service.register('u1', 'ExpoPushToken[abc]', undefined);
      expect(prisma.pushDevice.upsert).toHaveBeenCalledTimes(2);
    });

    it('upserts by token (not by user+token), so a device that changes owner reassigns the same row', async () => {
      await service.register('newOwner', VALID_TOKEN, 'android');
      expect(prisma.pushDevice.upsert).toHaveBeenCalledWith({
        where: { expoPushToken: VALID_TOKEN },
        create: {
          userId: 'newOwner',
          expoPushToken: VALID_TOKEN,
          platform: 'android',
        },
        update: { userId: 'newOwner', platform: 'android' },
        select: { id: true },
      });
    });
  });

  describe('unregister', () => {
    it("deletes only rows matching both userId and the token — never another user's device", async () => {
      await service.unregister('u1', VALID_TOKEN);
      expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', expoPushToken: VALID_TOKEN },
      });
    });

    it('is a silent no-op when the token was never registered to this user (idempotent, not an error)', async () => {
      prisma.pushDevice.deleteMany.mockResolvedValue({ count: 0 });
      await expect(
        service.unregister('u1', VALID_TOKEN),
      ).resolves.toBeUndefined();
    });
  });

  describe('removeStaleTokens', () => {
    it('does nothing for an empty list (no wasted query)', async () => {
      await service.removeStaleTokens([]);
      expect(prisma.pushDevice.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes every token in the given list, across any user', async () => {
      await service.removeStaleTokens(['t1', 't2']);
      expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
        where: { expoPushToken: { in: ['t1', 't2'] } },
      });
    });
  });
});
