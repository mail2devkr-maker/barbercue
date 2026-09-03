import { Test } from '@nestjs/testing';
import { PushDispatchService } from './push-dispatch.service';
import { PushDeviceService } from './push-device.service';
import { ExpoPushSender } from './expo-push-sender';

describe('PushDispatchService', () => {
  let service: PushDispatchService;
  let devices: {
    devicesForUser: jest.Mock;
    removeStaleTokens: jest.Mock;
  };
  let expo: { send: jest.Mock };

  beforeEach(async () => {
    devices = {
      devicesForUser: jest.fn().mockResolvedValue([]),
      removeStaleTokens: jest.fn().mockResolvedValue(undefined),
    };
    expo = { send: jest.fn().mockResolvedValue([]) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushDispatchService,
        { provide: PushDeviceService, useValue: devices },
        { provide: ExpoPushSender, useValue: expo },
      ],
    }).compile();
    service = moduleRef.get(PushDispatchService);
  });

  it('does nothing when the user has no registered devices (the common case pre-mobile-rollout)', async () => {
    await service.dispatchToUser('u1', { title: 'New booking', body: 'x' });
    expect(expo.send).not.toHaveBeenCalled();
  });

  it('sends one Expo message per registered device, carrying the given payload', async () => {
    devices.devicesForUser.mockResolvedValue([
      { expoPushToken: 'ExponentPushToken[a]' },
      { expoPushToken: 'ExponentPushToken[b]' },
    ]);
    expo.send.mockResolvedValue([{ status: 'ok' }, { status: 'ok' }]);
    await service.dispatchToUser('u1', {
      title: 'New booking',
      body: 'Haircut booked for your shop.',
      data: { type: 'booking.created', salonId: 's1', bookingId: 'b1' },
    });
    expect(expo.send).toHaveBeenCalledWith([
      {
        to: 'ExponentPushToken[a]',
        title: 'New booking',
        body: 'Haircut booked for your shop.',
        data: { type: 'booking.created', salonId: 's1', bookingId: 'b1' },
      },
      {
        to: 'ExponentPushToken[b]',
        title: 'New booking',
        body: 'Haircut booked for your shop.',
        data: { type: 'booking.created', salonId: 's1', bookingId: 'b1' },
      },
    ]);
  });

  it('removes only the devices Expo reports as DeviceNotRegistered, leaving healthy tokens alone', async () => {
    devices.devicesForUser.mockResolvedValue([
      { expoPushToken: 'ExponentPushToken[stale]' },
      { expoPushToken: 'ExponentPushToken[healthy]' },
    ]);
    expo.send.mockResolvedValue([
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'ok' },
    ]);
    await service.dispatchToUser('u1', { title: 't', body: 'b' });
    expect(devices.removeStaleTokens).toHaveBeenCalledWith([
      'ExponentPushToken[stale]',
    ]);
  });

  it('does not remove a device for a non-DeviceNotRegistered error (e.g. a transient MessageRateExceeded)', async () => {
    devices.devicesForUser.mockResolvedValue([
      { expoPushToken: 'ExponentPushToken[a]' },
    ]);
    expo.send.mockResolvedValue([
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ]);
    await service.dispatchToUser('u1', { title: 't', body: 'b' });
    expect(devices.removeStaleTokens).not.toHaveBeenCalled();
  });

  it('never throws when loading devices fails — a push failure must never break booking creation', async () => {
    devices.devicesForUser.mockRejectedValue(new Error('db down'));
    await expect(
      service.dispatchToUser('u1', { title: 't', body: 'b' }),
    ).resolves.toBeUndefined();
  });

  it('never throws when the Expo API call itself fails', async () => {
    devices.devicesForUser.mockResolvedValue([
      { expoPushToken: 'ExponentPushToken[a]' },
    ]);
    expo.send.mockRejectedValue(new Error('network error'));
    await expect(
      service.dispatchToUser('u1', { title: 't', body: 'b' }),
    ).resolves.toBeUndefined();
  });
});
