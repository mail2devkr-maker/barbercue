import { OffersService } from './offers.service';

// Offers are managed by the salon's owner, and also by a platform admin managing that salon.
// Every change records who made it (OWNER or PLATFORM_ADMIN) in the audit log.

const SALON = 'salon-1';
const draft = {
  kind: 'OFFER' as const,
  title: 'Festive 20% off',
  discountType: 'PERCENT' as const,
  discountValue: 20,
  audience: 'ALL' as const,
  validFrom: '2026-11-01T00:00:00.000Z',
  validTo: '2026-11-30T00:00:00.000Z',
  perCustomerLimit: 1,
  serviceIds: [],
  applicableDays: [],
};

function makeService(actedAs: 'OWNER' | 'PLATFORM_ADMIN' | Error) {
  const row = {
    id: 'offer-1',
    salonId: SALON,
    kind: 'OFFER',
    status: 'DRAFT',
    title: draft.title,
    description: null,
    discountType: 'PERCENT',
    discountValue: 20,
    currency: 'INR',
    audience: 'ALL',
    inactiveDays: null,
    validFrom: new Date(draft.validFrom),
    validTo: new Date(draft.validTo),
    maxRedemptions: null,
    perCustomerLimit: 1,
    minimumBookingAmount: null,
    maximumDiscountAmount: null,
    applicableDays: [],
    dailyStartTime: null,
    dailyEndTime: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    services: [],
    _count: { redemptions: 0 },
  };
  const tx = {
    salon: { findUnique: jest.fn().mockResolvedValue({ currency: 'INR' }) },
    offer: {
      create: jest.fn().mockResolvedValue(row),
      findFirst: jest.fn().mockResolvedValue(row),
    },
    offerService: { createMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const salonAccess = {
    assertOwnerOrAdminAccess: jest.fn(() =>
      actedAs instanceof Error
        ? Promise.reject(actedAs)
        : Promise.resolve(actedAs),
    ),
  };
  return {
    service: new OffersService(prisma as never, salonAccess as never),
    tx,
    salonAccess,
  };
}

describe('who can manage a salon’s offers', () => {
  it('a platform admin can create an offer for a salon, recorded as an admin action', async () => {
    const { service, tx, salonAccess } = makeService('PLATFORM_ADMIN');
    const created = await service.create('admin-1', SALON, draft as never);
    expect(salonAccess.assertOwnerOrAdminAccess).toHaveBeenCalledWith(
      'admin-1',
      SALON,
    );
    expect(created.status).toBe('DRAFT');
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'admin-1',
        action: 'OFFER_DRAFT_CREATED',
        metadata: expect.objectContaining({
          salonId: SALON,
          actedAs: 'PLATFORM_ADMIN',
        }),
      }),
    });
  });

  it('the owner’s changes are recorded as the owner’s', async () => {
    const { service, tx } = makeService('OWNER');
    await service.create('owner-1', SALON, draft as never);
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata.actedAs).toBe(
      'OWNER',
    );
  });

  it('anyone else is refused before anything is written', async () => {
    const { service, tx } = makeService(new Error('Forbidden'));
    await expect(
      service.create('barber-1', SALON, draft as never),
    ).rejects.toThrow('Forbidden');
    expect(tx.offer.create).not.toHaveBeenCalled();
  });
});
