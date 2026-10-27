import { BadRequestException } from '@nestjs/common';
import { guestJoinSchema, QueueGuestController } from './queue-guest.controller';

describe('No-Google queue guest entry', () => {
  const joinGuestWalkIn = jest.fn().mockResolvedValue({ id: 'q1', guestAccessToken: 'secret' });
  const getGuestEntry = jest.fn().mockResolvedValue({ id: 'q1', salonId: 's1' });
  const cancelGuestEntry = jest.fn().mockResolvedValue({ id: 'q1', status: 'CANCELLED' });
  const respondArrival = jest.fn().mockResolvedValue({ id: 'q1', customerArrivalResponse: true });
  const registerGuestPush = jest.fn().mockResolvedValue({ registered: true });
  const controller = new QueueGuestController(
    { joinGuestWalkIn, getGuestEntry, cancelGuestEntry, respondArrival, registerGuestPush } as never,
    { salon: { findUnique: jest.fn() } } as never,
  );

  it('requires all three fields and validates every ID and mobile number', () => {
    const good = guestJoinSchema.safeParse({
      serviceId: 'f4546678-426d-4a24-afd9-e72de22ef560',
      contactName: '  Guest Shopper  ',
      contactPhone: '9876543210',
    });
    expect(good.success).toBe(true);
    expect(guestJoinSchema.safeParse({ contactName: 'Test', contactPhone: '9876543210' }).success).toBe(false);
    expect(guestJoinSchema.safeParse({
      serviceId: 'f4546678-426d-4a24-afd9-e72de22ef560', contactName: 'T', contactPhone: 'bad',
    }).success).toBe(false);
  });

  it('does not ask for a signed-in identity', async () => {
    await expect(controller.join('s1', {
      serviceId: 'svc1', contactName: 'Guest', contactPhone: '+919876543210',
    })).resolves.toEqual({ id: 'q1', guestAccessToken: 'secret' });
    expect(joinGuestWalkIn).toHaveBeenCalledWith('s1', 'svc1', 'Guest', '+919876543210');
  });

  it('requires the guest token for status and cancellation; caller has no owner-user privileges', async () => {
    await controller.getStatus('q1', 'opaque');
    await controller.cancel('q1', 'opaque');
    expect(getGuestEntry).toHaveBeenCalledWith('q1', 'opaque');
    expect(cancelGuestEntry).toHaveBeenCalledWith('q1', 'opaque');
  });

  it('forbids non-boolean self arrival confirmations', () => {
    expect(() => controller.respondArrival('q1', 'opaque', { arrived: 'yes' })).toThrow(BadRequestException);
  });

  it('does not authorize guest device without an explicit Expo token string', () => {
    expect(() => controller.registerGuestDevice('q1', 'opaque', {})).toThrow(BadRequestException);
  });
});
