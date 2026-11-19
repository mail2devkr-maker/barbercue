import { AdminOnboardingController } from './admin-onboarding.controller';
import { assertOnboardingActivationEnabled } from './onboarding-activation';

describe('onboarding activation switch', () => {
  const original = process.env.ONBOARDING_ACTIVATION_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.ONBOARDING_ACTIVATION_ENABLED;
    else process.env.ONBOARDING_ACTIVATION_ENABLED = original;
  });

  it.each([undefined, '', 'false', 'TRUE', '1'])('refuses when set to %s', (value) => {
    if (value === undefined) delete process.env.ONBOARDING_ACTIVATION_ENABLED;
    else process.env.ONBOARDING_ACTIVATION_ENABLED = value;
    expect(() => assertOnboardingActivationEnabled()).toThrow(/not switched on/);
  });

  it('allows only the exact value true', () => {
    process.env.ONBOARDING_ACTIVATION_ENABLED = 'true';
    expect(() => assertOnboardingActivationEnabled()).not.toThrow();
  });

  it('stops every activating route before it reaches a service', () => {
    delete process.env.ONBOARDING_ACTIVATION_ENABLED;
    const service = () => {
      throw new Error('service reached');
    };
    const controller = new AdminOnboardingController(
      {} as never,
      { approve: service, resendInvitation: service } as never,
      { promotePhotos: service, publish: service } as never,
      {} as never,
      {} as never,
    );
    const user = { id: 'u' } as never;
    for (const call of [
      () => controller.approve(user, 'a', {} as never),
      () => controller.resendInvitation(user, 'a'),
      () => controller.promotePhotos(user, 'a', { mediaIds: [] } as never),
      () => controller.publish(user, 'a'),
    ]) {
      expect(call).toThrow(/not switched on/);
    }
  });
});
