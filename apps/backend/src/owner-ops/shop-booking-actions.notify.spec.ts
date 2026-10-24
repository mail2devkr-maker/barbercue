import { CancellationActor } from '@barbercue/shared';
import { ShopBookingActionsService } from './shop-booking-actions.service';

/**
 * Owner issue #36 - the customer must be told when the shop cancels, durably, only to the right
 * person, without claiming delivery that did not happen. Pure unit test with in-memory stand-ins.
 */
function booking(over: Record<string, unknown> = {}) {
  return {
    status: 'CANCELLED',
    cancelledAt: new Date('2026-10-24T10:00:00Z'),
    slotStart: new Date('2026-10-25T05:30:00Z'),
    serviceId: 's1',
    service: { name: 'Haircut', durationMinutes: 30, price: 100 },
    services: [{ serviceId: 's1', serviceName: 'Haircut', durationMinutes: 30, price: 100 }],
    salon: {
      name: 'Test Shop',
      phone: '+911234567890',
      showPhoneToCustomers: true,
      timezone: 'Asia/Kolkata',
      city: { countryCode: 'IN' },
    },
    ...over,
  };
}

function build(opts: {
  customerId: string | null;
  actorKind?: 'OWNER' | 'STAFF' | 'PLATFORM_ADMIN' | 'NONE';
  deliverImpl?: jest.Mock;
  salonOver?: Record<string, unknown>;
  staffOwnsBooking?: boolean;
}) {
  const deliverToUser =
    opts.deliverImpl ?? jest.fn(async () => ({ inApp: 'SENT', push: 'SKIPPED_NO_DEVICE' }));
  const cancelByShop = jest.fn(async () => ({
    customerId: opts.customerId,
    booking: booking(opts.salonOver ? { salon: { ...booking().salon, ...opts.salonOver } } : {}),
  }));
  const prisma = {
    salonStaff: { findFirst: jest.fn(async () => (opts.staffOwnsBooking === false ? null : { id: 'staff1' })) },
    booking: {
      findFirst: jest.fn(async () => ({
        preferredStaffId: opts.staffOwnsBooking === false ? 'someone-else' : 'staff1',
        queueEntries: [],
      })),
    },
  };
  const salonAccess = {
    assertAccessOrAdminAccess: jest.fn(async () => undefined),
    getActorKind: jest.fn(async () => opts.actorKind ?? 'OWNER'),
  };
  const push = {
    renderShopBookingPush: jest.fn(async () => ({ title: 'Booking cancelled', body: 'Test Shop cancelled your Haircut.' })),
  };
  const svc = new ShopBookingActionsService(
    prisma as never,
    salonAccess as never,
    { cancelByShop } as never,
    { deliverToUser } as never,
    push as never,
  );
  return { svc, deliverToUser, cancelByShop, push };
}

const owner = { id: 'owner1' } as never;

describe('owner cancellation -> customer notification (#36)', () => {
  it('notifies exactly the booking customer, with a dedupe key tied to the booking', async () => {
    const { svc, deliverToUser } = build({ customerId: 'cust1' });
    const res = await svc.cancel(owner, 'salonA', 'booking-123', { reason: 'Barber unwell' } as never);
    expect(deliverToUser).toHaveBeenCalledTimes(1);
    const arg = deliverToUser.mock.calls[0][0] as Record<string, any>;
    expect(arg.userId).toBe('cust1');
    expect(arg.type).toBe('booking.cancelled_by_shop');
    expect(arg.dedupeKey).toBe('booking.cancelled_by_shop:booking-123');
    expect(arg.inAppPayload).toMatchObject({ salonId: 'salonA', bookingId: 'booking-123', reason: 'Barber unwell', salonName: 'Test Shop' });
    expect(arg.deepLink).toBe('account/bookings');
    expect(res.cancelledByActor).toBe(CancellationActor.OWNER);
    expect(res.notification).toEqual({ inApp: 'SENT', push: 'SKIPPED_NO_DEVICE' });
  });

  it('a retried cancel reuses the same dedupe key (the ledger, not the caller, prevents a second notice)', async () => {
    const { svc, deliverToUser } = build({ customerId: 'cust1' });
    await svc.cancel(owner, 'salonA', 'booking-123', {} as never);
    await svc.cancel(owner, 'salonA', 'booking-123', {} as never);
    const keys = deliverToUser.mock.calls.map((c) => (c[0] as { dedupeKey: string }).dedupeKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('never mixes customers: the recipient is whatever the committed cancellation returned', async () => {
    const a = build({ customerId: 'custA' });
    const b = build({ customerId: 'custB' });
    await a.svc.cancel(owner, 'salonA', 'b1', {} as never);
    await b.svc.cancel(owner, 'salonA', 'b2', {} as never);
    expect((a.deliverToUser.mock.calls[0][0] as { userId: string }).userId).toBe('custA');
    expect((b.deliverToUser.mock.calls[0][0] as { userId: string }).userId).toBe('custB');
  });

  it('an in-shop guest has no account: nobody is notified and no delivery is claimed', async () => {
    const { svc, deliverToUser, push } = build({ customerId: null });
    const res = await svc.cancel(owner, 'salonA', 'b1', {} as never);
    expect(deliverToUser).not.toHaveBeenCalled();
    expect(push.renderShopBookingPush).not.toHaveBeenCalled();
    expect(res.notification).toEqual({ inApp: 'NO_ACCOUNT', push: 'NO_ACCOUNT' });
  });

  it('a delivery failure never undoes the cancellation and is reported as FAILED, never as sent', async () => {
    const failing = jest.fn(async () => {
      throw new Error('ledger unavailable');
    });
    const { svc } = build({ customerId: 'cust1', deliverImpl: failing });
    const res = await svc.cancel(owner, 'salonA', 'b1', {} as never);
    expect(res.status).toBe('CANCELLED');
    expect(res.notification).toEqual({ inApp: 'FAILED', push: 'FAILED' });
  });

  it('does not reveal the shop phone when the shop hides it from customers', async () => {
    const { svc, deliverToUser } = build({ customerId: 'cust1', salonOver: { showPhoneToCustomers: false } });
    await svc.cancel(owner, 'salonA', 'b1', {} as never);
    expect((deliverToUser.mock.calls[0][0] as { inAppPayload: { shopPhone: string | null } }).inAppPayload.shopPhone).toBeNull();
  });

  it('records the real actor: platform admin -> ADMIN, assigned barber -> STAFF', async () => {
    const admin = build({ customerId: 'c', actorKind: 'PLATFORM_ADMIN' });
    expect((await admin.svc.cancel(owner, 'salonA', 'b1', {} as never)).cancelledByActor).toBe(CancellationActor.ADMIN);
    const staff = build({ customerId: 'c', actorKind: 'STAFF' });
    expect((await staff.svc.cancel(owner, 'salonA', 'b1', {} as never)).cancelledByActor).toBe(CancellationActor.STAFF);
  });

  it('a barber cannot cancel (or probe) a booking that is not theirs, and nobody is notified', async () => {
    const { svc, deliverToUser, cancelByShop } = build({ customerId: 'c', actorKind: 'STAFF', staffOwnsBooking: false });
    await expect(svc.cancel(owner, 'salonA', 'b1', {} as never)).rejects.toMatchObject({ response: expect.anything() });
    expect(cancelByShop).not.toHaveBeenCalled();
    expect(deliverToUser).not.toHaveBeenCalled();
  });

  it('a caller with no relationship to the shop cannot cancel', async () => {
    const { svc, cancelByShop, deliverToUser } = build({ customerId: 'c', actorKind: 'NONE' });
    await expect(svc.cancel(owner, 'salonA', 'b1', {} as never)).rejects.toBeDefined();
    expect(cancelByShop).not.toHaveBeenCalled();
    expect(deliverToUser).not.toHaveBeenCalled();
  });
});
