import { Test } from '@nestjs/testing';
import { PushNotificationsController } from './push-notifications.controller';
import { PushDeviceService } from './push-device.service';

const USER = { id: 'u1', roles: [] } as { id: string; roles: [] };

describe('PushNotificationsController', () => {
  let controller: PushNotificationsController;
  let pushDevices: { register: jest.Mock; unregister: jest.Mock };

  beforeEach(async () => {
    pushDevices = {
      register: jest.fn().mockResolvedValue({ id: 'd1' }),
      unregister: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PushNotificationsController],
      providers: [{ provide: PushDeviceService, useValue: pushDevices }],
    }).compile();
    controller = moduleRef.get(PushNotificationsController);
  });

  it("registers a device under the authenticated caller's own id, never a client-supplied one", async () => {
    const result = await controller.register(USER, {
      expoPushToken: 'ExponentPushToken[a]',
      platform: 'android',
    });
    expect(pushDevices.register).toHaveBeenCalledWith(
      'u1',
      'ExponentPushToken[a]',
      'android',
    );
    expect(result).toEqual({ ok: true });
  });

  it("unregisters a device scoped to the authenticated caller's own id", async () => {
    const result = await controller.unregister(USER, {
      expoPushToken: 'ExponentPushToken[a]',
    });
    expect(pushDevices.unregister).toHaveBeenCalledWith(
      'u1',
      'ExponentPushToken[a]',
    );
    expect(result).toEqual({ ok: true });
  });
});
