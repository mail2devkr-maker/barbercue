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
  resolveShopRegistrationResume,
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

describe('resolveShopRegistrationResume (cold start / session restoration)', () => {
  const ME = 'owner-1';
  const noShops = jest.fn(async () => []);
  const ownsShop = jest.fn(async () => [{ isOwner: true }]);

  it('resumes an unfinished registration on a cold start (account has no shop yet)', async () => {
    await markShopRegistrationPending(NOW, ME);
    await expect(resolveShopRegistrationResume({ userId: ME, fetchWorkplaces: noShops, now: NOW + 1000 })).resolves.toBe(true);
    expect(await isShopRegistrationPending(NOW + 1000)).toBe(true);
  });

  it('keeps resuming on later cold starts until the shop exists', async () => {
    await markShopRegistrationPending(NOW, ME);
    for (let i = 1; i <= 3; i += 1) {
      await expect(resolveShopRegistrationResume({ userId: ME, fetchWorkplaces: noShops, now: NOW + i * 3_600_000 })).resolves.toBe(true);
    }
  });

  it('clears the marker and does NOT redirect when the account already owns a shop (e.g. registered on the website)', async () => {
    await markShopRegistrationPending(NOW, ME);
    await expect(resolveShopRegistrationResume({ userId: ME, fetchWorkplaces: ownsShop, now: NOW + 1000 })).resolves.toBe(false);
    expect(mockStore.has(SHOP_REGISTRATION_RESUME_KEY)).toBe(false);
    await expect(resolveShopRegistrationResume({ userId: ME, fetchWorkplaces: noShops, now: NOW + 2000 })).resolves.toBe(false);
  });

  it('a staff-only workplace (isOwner=false) does not count as owning a shop', async () => {
    await markShopRegistrationPending(NOW, ME);
    const staffOnly = jest.fn(async () => [{ isOwner: false }]);
    await expect(resolveShopRegistrationResume({ userId: ME, fetchWorkplaces: staffOnly, now: NOW + 1000 })).resolves.toBe(true);
  });

  it("never sends a different account into another account's registration, and clears the marker", async () => {
    await markShopRegistrationPending(NOW, ME);
    const fetchSpy = jest.fn(async () => []);
    await expect(resolveShopRegistrationResume({ userId: 'someone-else', fetchWorkplaces: fetchSpy, now: NOW + 1000 })).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockStore.has(SHOP_REGISTRATION_RESUME_KEY)).toBe(false);
  });

  it('keeps unfinished onboarding recoverable when the shop list cannot be read (offline / server error)', async () => {
    await markShopRegistrationPending(NOW, ME);
    const offline = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    await expect(resolveShopRegistrationResume({ userId: ME, fetchWorkplaces: offline, now: NOW + 1000 })).resolves.toBe(true);
    expect(mockStore.has(SHOP_REGISTRATION_RESUME_KEY)).toBe(true);
  });

  it('does nothing without a marker, with an expired marker, or with corrupt storage', async () => {
    await expect(resolveShopRegistrationResume({ userId: ME, fetchWorkplaces: noShops, now: NOW })).resolves.toBe(false);
    await markShopRegistrationPending(NOW, ME);
    await expect(resolveShopRegistrationResume({ userId: ME, fetchWorkplaces: noShops, now: NOW + RESUME_WINDOW_MS + 1 })).resolves.toBe(false);
    mockStore.set(SHOP_REGISTRATION_RESUME_KEY, 'not json');
    await expect(resolveShopRegistrationResume({ userId: ME, fetchWorkplaces: noShops, now: NOW })).resolves.toBe(false);
  });

  it('a marker written by a build that recorded no account id still resumes, after the shop check', async () => {
    await markShopRegistrationPending(NOW);
    await expect(resolveShopRegistrationResume({ userId: ME, fetchWorkplaces: noShops, now: NOW + 1000 })).resolves.toBe(true);
    await expect(resolveShopRegistrationResume({ userId: ME, fetchWorkplaces: ownsShop, now: NOW + 2000 })).resolves.toBe(false);
  });

  it('stores only version, time and an opaque account id', async () => {
    await markShopRegistrationPending(NOW, ME);
    expect(JSON.parse(mockStore.get(SHOP_REGISTRATION_RESUME_KEY)!)).toEqual({ v: 1, since: NOW, userId: ME });
  });
});
