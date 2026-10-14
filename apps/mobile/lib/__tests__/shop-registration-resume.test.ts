const mockStore = new Map<string, string>();
jest.mock('../secure-storage', () => ({
  getItem: jest.fn(async (key: string) => (mockStore.has(key) ? mockStore.get(key)! : null)),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

import * as secureStorage from '../secure-storage';
import {
  RESUME_WINDOW_MS,
  SHOP_REGISTRATION_RESUME_KEY,
  clearShopRegistrationPending,
  isShopRegistrationPending,
  markShopRegistrationPending,
} from '../shop-registration-resume';

const NOW = 1_800_000_000_000;

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('shop registration resume marker', () => {
  it('is not pending on a clean install', async () => {
    await expect(isShopRegistrationPending(NOW)).resolves.toBe(false);
  });

  it('is pending after the owner account is created, and survives a "restart" (a fresh read)', async () => {
    await markShopRegistrationPending(NOW);
    await expect(isShopRegistrationPending(NOW + 60_000)).resolves.toBe(true);
  });

  it('is cleared once the shop exists', async () => {
    await markShopRegistrationPending(NOW);
    await clearShopRegistrationPending();
    await expect(isShopRegistrationPending(NOW)).resolves.toBe(false);
  });

  it('expires, so an abandoned attempt cannot redirect a returning customer forever', async () => {
    await markShopRegistrationPending(NOW);
    await expect(isShopRegistrationPending(NOW + RESUME_WINDOW_MS)).resolves.toBe(true);
    await expect(isShopRegistrationPending(NOW + RESUME_WINDOW_MS + 1)).resolves.toBe(false);
  });

  it.each(['not json', '{}', '{"v":2,"since":1}', '{"v":1,"since":"x"}', '{"v":1,"since":null}'])(
    'treats corrupt storage (%s) as "not pending" and never throws',
    async (raw) => {
      mockStore.set(SHOP_REGISTRATION_RESUME_KEY, raw);
      await expect(isShopRegistrationPending(NOW)).resolves.toBe(false);
    },
  );

  it('ignores a timestamp from the future (clock change) instead of trusting it', async () => {
    await markShopRegistrationPending(NOW + 10 * 60_000);
    await expect(isShopRegistrationPending(NOW)).resolves.toBe(false);
  });

  it('stores only a version and a time — no account data, tokens or shop details', async () => {
    await markShopRegistrationPending(NOW);
    expect(JSON.parse(mockStore.get(SHOP_REGISTRATION_RESUME_KEY)!)).toEqual({ v: 1, since: NOW });
  });

  it('never blocks account creation when storage fails', async () => {
    (secureStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('keystore locked'));
    await expect(markShopRegistrationPending(NOW)).resolves.toBeUndefined();
    (secureStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('keystore locked'));
    await expect(isShopRegistrationPending(NOW)).resolves.toBe(false);
    (secureStorage.deleteItem as jest.Mock).mockRejectedValueOnce(new Error('keystore locked'));
    await expect(clearShopRegistrationPending()).resolves.toBeUndefined();
  });
});
