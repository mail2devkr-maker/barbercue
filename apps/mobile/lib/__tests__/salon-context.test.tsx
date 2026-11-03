/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { SalonStatus, type SalonWorkplaceDto } from '@barbercue/shared';

// Owner requirement: the owner stays in THEIR shop. A single shop is opened directly; with several, the
// last shop is restored after a relaunch only if the server still lists it; otherwise the user picks.

jest.mock('../api', () => ({ apiFetch: jest.fn() }));
const mockStore = new Map<string, string>();
jest.mock('../secure-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
  deleteItem: jest.fn(async (key: string) => void mockStore.delete(key)),
}));
const mockAuth = { userId: 'owner-1' as string | null };
jest.mock('../auth-context', () => ({
  useAuth: () => ({ user: mockAuth.userId ? { id: mockAuth.userId, roles: ['SALON_OWNER'] } : null, status: 'authenticated' }),
}));
// A STABLE object, like the real provider: `load` depends on `t`, so a new object per render would loop.
const mockLanguage = { t: { couldNotLoadSalons: 'Could not load shops.' }, language: 'EN' };
jest.mock('../language-context', () => ({ useLanguage: () => mockLanguage }));

import { apiFetch } from '../api';
import { SalonProvider, useSalon } from '../salon-context';
import { LAST_SHOP_KEY } from '../owner/last-shop';

const shop = (id: string, name: string): SalonWorkplaceDto => ({ id, publicId: `P-${id}`, slug: id, name, status: SalonStatus.ACTIVE, isOwner: true });

let latest: ReturnType<typeof useSalon> | undefined;
function Probe() {
  latest = useSalon();
  return null;
}

async function mount(shops: SalonWorkplaceDto[]) {
  (apiFetch as jest.Mock).mockResolvedValue(shops);
  await act(async () => {
    TestRenderer.create(createElement(SalonProvider, null, createElement(Probe)));
  });
  await act(async () => {});
  return latest!;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mockStore.clear();
  mockAuth.userId = 'owner-1';
  latest = undefined;
  jest.clearAllMocks();
});

describe('SalonProvider selection', () => {
  it('opens the only shop directly', async () => {
    const ctx = await mount([shop('s1', 'One')]);
    expect(ctx.selectedSalonId).toBe('s1');
  });

  it('asks for a choice (nothing selected) for a multi-shop owner with no remembered shop', async () => {
    const ctx = await mount([shop('s1', 'One'), shop('s2', 'Two')]);
    expect(ctx.selectedSalonId).toBeNull();
    expect(ctx.workplaces).toHaveLength(2);
  });

  it('restores the last shop after a relaunch when the server still lists it', async () => {
    mockStore.set(LAST_SHOP_KEY, JSON.stringify({ v: 1, u: 'owner-1', s: 's2' }));
    const ctx = await mount([shop('s1', 'One'), shop('s2', 'Two')]);
    expect(ctx.selectedSalonId).toBe('s2');
  });

  it('never restores a shop the server no longer lists (no unauthorised shop is ever selected)', async () => {
    mockStore.set(LAST_SHOP_KEY, JSON.stringify({ v: 1, u: 'owner-1', s: 'gone' }));
    const ctx = await mount([shop('s1', 'One'), shop('s2', 'Two')]);
    expect(ctx.selectedSalonId).toBeNull();
  });

  it('never uses another account remembered shop', async () => {
    mockStore.set(LAST_SHOP_KEY, JSON.stringify({ v: 1, u: 'someone-else', s: 's2' }));
    const ctx = await mount([shop('s1', 'One'), shop('s2', 'Two')]);
    expect(ctx.selectedSalonId).toBeNull();
  });

  it('remembers a shop the owner selects, per account', async () => {
    const ctx = await mount([shop('s1', 'One'), shop('s2', 'Two')]);
    await act(async () => ctx.selectSalon('s1'));
    expect(JSON.parse(mockStore.get(LAST_SHOP_KEY) as string)).toEqual({ v: 1, u: 'owner-1', s: 's1' });
    expect(latest!.selectedSalonId).toBe('s1');
    expect(latest!.selectedSalon?.name).toBe('One');
  });

  it('keeps working when storage is unavailable', async () => {
    const storage = jest.requireMock('../secure-storage') as { getItem: jest.Mock; setItem: jest.Mock };
    storage.getItem.mockRejectedValueOnce(new Error('keystore locked'));
    storage.setItem.mockRejectedValueOnce(new Error('keystore locked'));
    const ctx = await mount([shop('s1', 'One'), shop('s2', 'Two')]);
    expect(ctx.selectedSalonId).toBeNull();
    await act(async () => ctx.selectSalon('s2'));
    expect(latest!.selectedSalonId).toBe('s2');
  });

  it('a reload keeps the selection while the shop is still listed, and drops it once it is not', async () => {
    const ctx = await mount([shop('s1', 'One'), shop('s2', 'Two')]);
    await act(async () => ctx.selectSalon('s2'));
    (apiFetch as jest.Mock).mockResolvedValue([shop('s1', 'One'), shop('s2', 'Two')]);
    await act(async () => latest!.reload());
    await act(async () => {});
    expect(latest!.selectedSalonId).toBe('s2');
    (apiFetch as jest.Mock).mockResolvedValue([shop('s1', 'One'), shop('s3', 'Three')]);
    await act(async () => latest!.reload());
    await act(async () => {});
    expect(latest!.selectedSalonId).toBeNull();
  });
});
