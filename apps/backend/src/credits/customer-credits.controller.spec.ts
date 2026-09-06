import { CustomerCreditsController } from './customer-credits.controller';
import { SessionAudience, type AuthenticatedUser } from '@barbercue/shared';

describe('CustomerCreditsController', () => {
  let controller: CustomerCreditsController;
  let credits: { getBalance: jest.Mock; getHistory: jest.Mock };

  beforeEach(() => {
    credits = { getBalance: jest.fn(), getHistory: jest.fn() };
    controller = new CustomerCreditsController(credits as never);
  });

  function user(id: string): AuthenticatedUser {
    return { id, roles: ['CUSTOMER'] as never, audience: SessionAudience.CUSTOMER };
  }

  it('getBalance() looks up only the calling user’s own balance — never a client-supplied id', async () => {
    await controller.getBalance(user('u1'));
    expect(credits.getBalance).toHaveBeenCalledWith('u1');
    await controller.getBalance(user('u2'));
    expect(credits.getBalance).toHaveBeenLastCalledWith('u2');
  });

  it('getHistory() forwards the cursor and a valid limit unchanged', async () => {
    await controller.getHistory(user('u1'), 'cursor-1', '10');
    expect(credits.getHistory).toHaveBeenCalledWith('u1', 'cursor-1', 10);
  });

  it('getHistory() ignores an invalid limit and lets the service apply its own default', async () => {
    await controller.getHistory(user('u1'), undefined, 'not-a-number');
    expect(credits.getHistory).toHaveBeenCalledWith('u1', undefined, undefined);
  });

  it('getHistory() caps an excessive limit at 100', async () => {
    await controller.getHistory(user('u1'), undefined, '10000');
    expect(credits.getHistory).toHaveBeenCalledWith('u1', undefined, 100);
  });
});
