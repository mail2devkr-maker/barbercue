import { PremiumController } from './premium.controller';
import type { AuthenticatedUser } from '@barbercue/shared';

describe('PremiumController', () => {
  let controller: PremiumController;
  let plans: { listActivePlans: jest.Mock };
  let entitlement: { getEntitlement: jest.Mock; activateForDevelopment: jest.Mock };
  let aiCredits: { getBalance: jest.Mock };
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    plans = { listActivePlans: jest.fn() };
    entitlement = { getEntitlement: jest.fn(), activateForDevelopment: jest.fn() };
    aiCredits = { getBalance: jest.fn() };
    controller = new PremiumController(plans as never, entitlement as never, aiCredits as never);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function user(id: string): AuthenticatedUser {
    return { id, roles: ['CUSTOMER'] as never };
  }

  it('me() looks up only the calling user\'s own entitlement — never a client-supplied id', async () => {
    await controller.me(user('u1'));
    expect(entitlement.getEntitlement).toHaveBeenCalledWith('u1');

    await controller.me(user('u2'));
    expect(entitlement.getEntitlement).toHaveBeenLastCalledWith('u2');
  });

  it('credits() looks up only the calling user\'s own balance', async () => {
    await controller.credits(user('u1'));
    expect(aiCredits.getBalance).toHaveBeenCalledWith('u1');
  });

  it('listPlans() returns the plan catalog with no user context required', async () => {
    plans.listActivePlans.mockResolvedValue([{ id: 'basic' }]);
    await expect(controller.listPlans()).resolves.toEqual([{ id: 'basic' }]);
  });

  describe('devActivate — production safety gate', () => {
    it('refuses to activate Premium when NODE_ENV=production, without ever calling the entitlement service', async () => {
      process.env.NODE_ENV = 'production';
      await expect(
        controller.devActivate(user('u1'), { planId: 'pro' }),
      ).rejects.toMatchObject({ code: 'DEV_ACTIVATION_DISABLED' });
      expect(entitlement.activateForDevelopment).not.toHaveBeenCalled();
    });

    it('activates Premium for the calling user only, outside production', async () => {
      process.env.NODE_ENV = 'development';
      entitlement.activateForDevelopment.mockResolvedValue({ isPremium: true, planId: 'pro' });

      await controller.devActivate(user('u1'), { planId: 'pro' });

      expect(entitlement.activateForDevelopment).toHaveBeenCalledWith('u1', 'pro');
    });
  });
});
