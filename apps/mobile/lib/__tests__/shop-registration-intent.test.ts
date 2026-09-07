import { stashPendingShopRegistrationIntent, takePendingShopRegistrationIntent } from '../shop-registration-intent';

describe('shop-registration-intent', () => {
  it('take returns false when nothing was stashed', () => {
    expect(takePendingShopRegistrationIntent()).toBe(false);
  });

  it('take returns true exactly once after a stash — a second take does not re-fire it', () => {
    stashPendingShopRegistrationIntent();

    expect(takePendingShopRegistrationIntent()).toBe(true);
    expect(takePendingShopRegistrationIntent()).toBe(false);
  });

  it('stashing again after a take can be replayed independently', () => {
    stashPendingShopRegistrationIntent();
    takePendingShopRegistrationIntent();

    stashPendingShopRegistrationIntent();
    expect(takePendingShopRegistrationIntent()).toBe(true);
  });
});
