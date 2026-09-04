import { Test } from '@nestjs/testing';
import { Language } from '@barbercue/shared';
import { PushDispatchService } from './push-dispatch.service';
import { PushDeviceService } from './push-device.service';
import { ExpoPushSender } from './expo-push-sender';
import { PrismaService } from '../prisma/prisma.service';

describe('PushDispatchService', () => {
  let service: PushDispatchService;
  let devices: {
    devicesForUser: jest.Mock;
    removeStaleTokens: jest.Mock;
  };
  let expo: { send: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    devices = {
      devicesForUser: jest.fn().mockResolvedValue([]),
      removeStaleTokens: jest.fn().mockResolvedValue(undefined),
    };
    expo = { send: jest.fn().mockResolvedValue([]) };
    prisma = { user: { findUnique: jest.fn().mockResolvedValue({ preferredLanguage: Language.EN }) } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushDispatchService,
        { provide: PushDeviceService, useValue: devices },
        { provide: ExpoPushSender, useValue: expo },
        { provide: PrismaService, useValue: prisma },
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

// Build 9 physical-device defect fix: a booking push's title/body was previously hardcoded
// English regardless of the recipient owner's own preferredLanguage.
describe('PushDispatchService.dispatchLocalizedToUser', () => {
  let service: PushDispatchService;
  let devices: { devicesForUser: jest.Mock; removeStaleTokens: jest.Mock };
  let expo: { send: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    devices = {
      devicesForUser: jest.fn().mockResolvedValue([{ expoPushToken: 'ExponentPushToken[a]' }]),
      removeStaleTokens: jest.fn().mockResolvedValue(undefined),
    };
    expo = { send: jest.fn().mockResolvedValue([{ status: 'ok' }]) };
    prisma = { user: { findUnique: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushDispatchService,
        { provide: PushDeviceService, useValue: devices },
        { provide: ExpoPushSender, useValue: expo },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(PushDispatchService);
  });

  it('sends an English push when the recipient has no language preference set', async () => {
    prisma.user.findUnique.mockResolvedValue({ preferredLanguage: null });
    await service.dispatchLocalizedToUser('owner-1', 'newBooking', 'Haircut', {
      type: 'booking.created',
    });
    expect(expo.send).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'New booking', body: 'Haircut booked for your shop.' }),
    ]);
  });

  it('sends a Hindi push when the recipient has Hindi selected', async () => {
    prisma.user.findUnique.mockResolvedValue({ preferredLanguage: Language.HI });
    await service.dispatchLocalizedToUser('owner-1', 'newBooking', 'Haircut', {
      type: 'booking.created',
    });
    const [[messages]] = expo.send.mock.calls;
    expect(messages[0].title).not.toBe('New booking');
    expect(messages[0].body).not.toContain('Haircut booked for your shop');
  });

  it('localizes a cancellation push independently of a new-booking push', async () => {
    prisma.user.findUnique.mockResolvedValue({ preferredLanguage: Language.HI });
    await service.dispatchLocalizedToUser('owner-1', 'bookingCancelled', 'Haircut', {
      type: 'booking.cancelled',
    });
    const [[messages]] = expo.send.mock.calls;
    expect(messages[0].title).not.toBe('Booking cancelled');
  });

  it('degrades to English rather than failing when the recipient-language lookup itself throws', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));
    await expect(
      service.dispatchLocalizedToUser('owner-1', 'newBooking', 'Haircut', { type: 'booking.created' }),
    ).resolves.toBeUndefined();
    expect(expo.send).toHaveBeenCalledWith([expect.objectContaining({ title: 'New booking' })]);
  });
});
