import { AdminCreditsController } from './admin-credits.controller';
import { SessionAudience, type AuthenticatedUser } from '@barbercue/shared';

describe('AdminCreditsController', () => {
  let controller: AdminCreditsController;
  let credits: { grantPromotionalCredits: jest.Mock };

  beforeEach(() => {
    credits = { grantPromotionalCredits: jest.fn().mockResolvedValue({ id: 'tx1' }) };
    controller = new AdminCreditsController(credits as never);
  });

  function admin(id: string): AuthenticatedUser {
    return { id, roles: ['PLATFORM_ADMIN'] as never, audience: SessionAudience.ADMIN };
  }

  function req(idempotencyKey: string | undefined) {
    return {
      header: (name: string) =>
        name === 'Idempotency-Key' ? idempotencyKey : undefined,
    } as never;
  }

  const body = {
    customerId: 'u1',
    amount: 100,
    reason: 'Launch promo',
    fundingSource: 'FASTQUE_FUNDED' as const,
  };

  it('passes the actor, the Idempotency-Key header value, and the body through to the service', async () => {
    await controller.grant(admin('admin-1'), body, req('idem-123'));
    expect(credits.grantPromotionalCredits).toHaveBeenCalledWith(
      'admin-1',
      'idem-123',
      body,
    );
  });

  it('throws IDEMPOTENCY_KEY_REQUIRED and never calls the service when the header is missing', async () => {
    await expect(
      controller.grant(admin('admin-1'), body, req(undefined)),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(credits.grantPromotionalCredits).not.toHaveBeenCalled();
  });
});
