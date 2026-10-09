/// <reference types="jest" />
jest.setTimeout(30_000);

import { act, createElement } from 'react';
import { Share } from 'react-native';
import { uiStringsFor } from '@barbercue/shared';
import { allText, byTestId, flush, has, press, render, type as typeText } from '../../../lib/location/__fixtures__/render';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));
jest.mock('../../../lib/language-context', () => {
  const { uiStringsFor: strings } = require('@barbercue/shared');
  return { useLanguage: () => ({ language: 'EN', setLanguage: jest.fn(), t: strings('EN') }) };
});

const mockSalon: { value: Record<string, unknown> } = { value: {} };
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => mockSalon.value }));

const mockNavigation = { navigate: jest.fn() };
jest.mock('@react-navigation/native', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]), useNavigation: () => mockNavigation };
});

jest.mock('../../../lib/api', () => {
  class MockApiError extends Error {
    status = 400;
    code: string;
    details?: unknown;
    constructor(message: string, code = 'ERR', details?: unknown) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

// Heavy native-backed pieces that have their own tests/behaviour are stood in for.
jest.mock('../../../components/owner/OwnerVoiceSettingsCard', () => {
  const { Text } = require('react-native');
  return { OwnerVoiceSettingsCard: () => <Text testID="voice-card">voice</Text> };
});
jest.mock('../../../components/owner/ShopSetupSections', () => {
  const { Text } = require('react-native');
  return {
    scope: (id: string, seg: string) => `dashboard/salons/${id}/${seg}`,
    PaymentQrSection: ({ paymentQr }: { paymentQr: { paymentQrImageUrl: string | null } | null }) => (
      <Text testID="payment-qr-section">{paymentQr?.paymentQrImageUrl ? 'configured' : 'not-configured'}</Text>
    ),
  };
});

import { apiFetch, ApiError } from '../../../lib/api';
import OwnerSettingsScreen from '../OwnerSettingsScreen';

const apiMock = apiFetch as jest.Mock;
const t = uiStringsFor('EN');
const ApiErr = ApiError as unknown as new (m: string, c?: string, d?: unknown) => Error;

const SALON_A = { id: 'salon-a', name: 'Handsome Center', status: 'ACTIVE', isClosedForToday: false, isOwner: true };
const SALON_B = { id: 'salon-b', name: 'Second Shop', status: 'PENDING', isClosedForToday: false, isOwner: true };
function setSalon(selectedId: string | null) {
  const workplaces = [SALON_A, SALON_B];
  mockSalon.value = {
    workplaces,
    loading: false,
    error: null,
    selectedSalonId: selectedId,
    selectedSalon: workplaces.find((w) => w.id === selectedId) ?? null,
    selectSalon: jest.fn(),
    reload: jest.fn(),
  };
}

type Handlers = Partial<Record<'detail' | 'services' | 'chairs' | 'staff' | 'profile' | 'timezone' | 'queueQr' | 'paymentQr' | 'status', (method: string, body?: unknown) => unknown>>;
const state = { salon: { id: 'salon-a', publicId: 'BC-SHOP-000001', slug: 'handsome-center', name: 'Handsome Center', status: 'ACTIVE', isClosedForToday: false } };
const PROFILE = { id: 'salon-a', name: 'Handsome Center', phone: '+919876543210', email: 'shop@example.com', addressLine: 'Main Road, Hajipur', postalCode: '844101', description: 'Fades' };
const TZ_NOT_SET = { id: 'salon-a', timezone: null, countryCode: 'IN', timezoneAutoDetected: false, timezoneManuallyOverridden: false, suggestion: { timezone: 'Asia/Kolkata', confidence: 'HIGH', source: 'country' } };
const READY = { services: [{ isActive: true }], chairs: [{ status: 'ACTIVE' }], staff: [{ status: 'ACTIVE' }] };

function route(h: Handlers = {}, data: { services: unknown[]; chairs: unknown[]; staff: unknown[] } = READY) {
  apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    const call = (key: keyof Handlers, fallback: unknown) => {
      const out = h[key] ? h[key]!(method, body) : fallback;
      if (out instanceof Error) throw out;
      return out;
    };
    if (path.startsWith('salons/mine/')) return call('detail', state.salon);
    if (path.endsWith('/services')) return data.services;
    if (path.endsWith('/chairs')) return data.chairs;
    if (path.endsWith('/staff')) return data.staff;
    if (path.endsWith('/payment-qr')) return call('paymentQr', { salonId: 'salon-a', paymentQrImageUrl: null });
    if (path.endsWith('/profile')) return call('profile', method === 'PATCH' ? { ...PROFILE, ...body } : PROFILE);
    if (path.endsWith('/timezone')) return call('timezone', method === 'PATCH' ? { ...TZ_NOT_SET, timezone: body.timezone, suggestion: null } : { ...TZ_NOT_SET, timezone: 'Asia/Kolkata', suggestion: null });
    if (path.endsWith('/queue-qr')) return call('queueQr', { publicQueueToken: 'tok123', publicQueueUrl: 'https://fastque.com/q/tok123' });
    if (path.endsWith('/status')) return call('status', { id: 'salon-a', status: body.status, isClosedForToday: false });
    throw new Error(`unexpected ${method} ${path}`);
  });
}
const callsTo = (suffix: string, method?: string) =>
  apiMock.mock.calls.filter(([p, o]) => String(p).endsWith(suffix) && (!method || (o?.method ?? 'GET') === method));
const mount = () => render(createElement(OwnerSettingsScreen as never));
// A readiness row renders its tick and label as separate text nodes; read the row as one string.
const rowText = (r: Awaited<ReturnType<typeof render>>, id: string) => {
  const parts: string[] = [];
  const walk = (node: { children?: unknown[] } | string) => (typeof node === 'string' ? parts.push(node) : node.children?.forEach((c) => walk(c as never)));
  walk(byTestId(r, `readiness-${id}`)[0] as never);
  return parts.join('').replace(/\s+/g, ' ').trim();
};

beforeEach(() => {
  jest.clearAllMocks();
  state.salon = { id: 'salon-a', publicId: 'BC-SHOP-000001', slug: 'handsome-center', name: 'Handsome Center', status: 'ACTIVE', isClosedForToday: false };
  setSalon('salon-a');
});

describe('Owner Settings', () => {
  it('shows the shop identity from the real record: shop ID, plain-words status and page address', async () => {
    route();
    const r = await mount();
    await flush(8);
    expect(allText(r)).toContain('BC-SHOP-000001');
    expect(allText(r)).toContain(t.shopStatusOpen);
    expect(allText(r)).toContain('/book/handsome-center');
    expect(has(r, 'voice-card')).toBe(true);
  });

  it('loads the profile and saves only validated, trimmed changes with a PATCH to this shop', async () => {
    route();
    const r = await mount();
    await flush(8);
    expect(byTestId(r, 'profile-name')[0].props.value).toBe('Handsome Center');
    await typeText(r, 'profile-name', '  Handsome Center & Spa  ');
    await press(r, 'profile-save');
    await flush(4);
    const [path, options] = callsTo('/profile', 'PATCH')[0];
    expect(path).toBe('dashboard/salons/salon-a/profile');
    expect(JSON.parse(options.body)).toMatchObject({ name: 'Handsome Center & Spa', phone: '+919876543210', postalCode: '844101' });
    expect(has(r, 'profile-saved')).toBe(true);
  });

  it('refuses an invalid email locally (no request) and shows why', async () => {
    route();
    const r = await mount();
    await flush(8);
    await typeText(r, 'profile-email', 'not-an-email');
    await press(r, 'profile-save');
    await flush(4);
    expect(callsTo('/profile', 'PATCH')).toHaveLength(0);
    expect(has(r, 'profile-saved')).toBe(false);
    expect(allText(r).toLowerCase()).toMatch(/email/);
  });

  it('shows a permission failure from the server instead of pretending it saved', async () => {
    route({ profile: (method) => (method === 'PATCH' ? new ApiErr('You can only edit your own shop.') : PROFILE) });
    const r = await mount();
    await flush(8);
    await typeText(r, 'profile-name', 'Hacked');
    await press(r, 'profile-save');
    await flush(4);
    expect(allText(r)).toContain('You can only edit your own shop.');
    expect(has(r, 'profile-saved')).toBe(false);
  });

  it('closing an open shop sends SUSPENDED and updates the shop list context', async () => {
    route();
    const r = await mount();
    await flush(8);
    await press(r, 'status-close');
    await flush(4);
    const [, options] = callsTo('/status', 'PATCH')[0];
    expect(JSON.parse(options.body)).toEqual({ status: 'SUSPENDED' });
    expect((mockSalon.value.reload as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect(allText(r)).toContain(t.shopStatusPaused);
  });

  it('a closed-for-today shop is reopened explicitly', async () => {
    state.salon = { ...state.salon, isClosedForToday: true };
    route();
    const r = await mount();
    await flush(8);
    expect(allText(r)).toContain(t.shopStatusClosedToday);
    await press(r, 'status-open');
    await flush(4);
    expect(JSON.parse(callsTo('/status', 'PATCH')[0][1].body)).toEqual({ status: 'ACTIVE' });
  });

  it('a not-yet-open shop that is NOT ready lists exactly what is missing and offers Continue setup, not Open', async () => {
    state.salon = { ...state.salon, status: 'PENDING' };
    route({}, { services: [{ isActive: true }], chairs: [], staff: [] });
    const r = await mount();
    await flush(8);
    expect(has(r, 'settings-readiness')).toBe(true);
    expect(rowText(r, 'service')).toBe(`✓ ${t.readinessServiceDone}`);
    expect(rowText(r, 'chair')).toBe(`✗ ${t.readinessAddChair}`);
    expect(rowText(r, 'barber')).toBe(`✗ ${t.readinessAddBarber}`);
    expect(has(r, 'status-open')).toBe(false);
    await press(r, 'status-continue-setup');
    expect(mockNavigation.navigate).toHaveBeenCalledWith('OwnerServices');
  });

  it('a ready PENDING shop can be opened', async () => {
    state.salon = { ...state.salon, status: 'PENDING' };
    route();
    const r = await mount();
    await flush(8);
    await press(r, 'status-open');
    await flush(4);
    expect(JSON.parse(callsTo('/status', 'PATCH')[0][1].body)).toEqual({ status: 'ACTIVE' });
  });

  it('when the server still refuses (setup incomplete), its readiness answer wins over the local guess', async () => {
    state.salon = { ...state.salon, status: 'PENDING' };
    route({
      status: () => new ApiErr('Finish setup first.', 'SALON_SETUP_INCOMPLETE', { hasActiveService: true, hasActiveChair: false, hasActiveStaff: true }),
    });
    const r = await mount();
    await flush(8);
    await press(r, 'status-open');
    await flush(4);
    expect(allText(r)).toContain('Finish setup first.');
    expect(rowText(r, 'chair')).toBe(`✗ ${t.readinessAddChair}`);
    expect(rowText(r, 'service')).toBe(`✓ ${t.readinessServiceDone}`);
    expect(rowText(r, 'barber')).toBe(`✓ ${t.readinessBarberDone}`);
  });

  it('time zone: an unset zone starts on the detected suggestion, saves only on request, and persists the choice', async () => {
    route({ timezone: (method, body) => (method === 'GET' ? TZ_NOT_SET : { ...TZ_NOT_SET, timezone: (body as { timezone: string }).timezone, suggestion: null }) });
    const r = await mount();
    await flush(8);
    expect(allText(r)).toContain(t.timezoneCurrent.replace('{zone}', t.timezoneNotSet));
    expect(callsTo('/timezone', 'PATCH')).toHaveLength(0); // never auto-applied
    await press(r, 'timezone-option-Asia/Kolkata');
    await press(r, 'timezone-save');
    await flush(4);
    expect(JSON.parse(callsTo('/timezone', 'PATCH')[0][1].body)).toEqual({ timezone: 'Asia/Kolkata' });
    expect(has(r, 'timezone-saved')).toBe(true);
  });

  it('time zone search narrows the choices', async () => {
    route();
    const r = await mount();
    await flush(8);
    await typeText(r, 'timezone-search', 'new york');
    expect(has(r, 'timezone-option-America/New_York')).toBe(true);
    expect(has(r, 'timezone-option-Asia/Kolkata')).toBe(false);
  });

  it('queue QR: draws a QR for the exact URL the backend returned, shows it, and shares it', async () => {
    route();
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const r = await mount();
    await flush(8);
    expect(has(r, 'qr-code') || has(r, 'qr-fallback')).toBe(true);
    expect(allText(r)).toContain('https://fastque.com/q/tok123');
    await press(r, 'queue-qr-share');
    expect(share).toHaveBeenCalledWith({ message: t.queueQrShareMessage.replace('{shop}', 'Handsome Center').replace('{url}', 'https://fastque.com/q/tok123') });
  });

  it('shows the payment QR section with the loaded configuration state', async () => {
    route({ paymentQr: () => ({ salonId: 'salon-a', paymentQrImageUrl: 'https://img.example/qr.png' }) });
    const r = await mount();
    await flush(8);
    expect(allText(r)).toContain('configured');
  });

  it('every request is scoped to the selected shop; switching shop reloads and never mixes records', async () => {
    route();
    const r = await mount();
    await flush(8);
    const first = apiMock.mock.calls.map((c) => String(c[0]));
    expect(first.every((p) => p.includes('salon-a'))).toBe(true);
    apiMock.mockClear();
    state.salon = { id: 'salon-b', publicId: 'BC-SHOP-000002', slug: 'second-shop', name: 'Second Shop', status: 'PENDING', isClosedForToday: false };
    setSalon('salon-b');
    await act(async () => r.update(createElement(OwnerSettingsScreen as never)));
    await flush(8);
    const second = apiMock.mock.calls.map((c) => String(c[0]));
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((p) => p.includes('salon-b'))).toBe(true);
    expect(allText(r)).toContain('BC-SHOP-000002');
    expect(allText(r)).not.toContain('BC-SHOP-000001');
  });

  it('a load failure shows the server message; no shop selected asks to pick one without any request', async () => {
    route({ detail: () => new ApiErr('Shop not found.') });
    const failed = await mount();
    await flush(8);
    expect(allText(failed)).toContain('Shop not found.');
    apiMock.mockClear();
    setSalon(null);
    const none = await mount();
    await flush(4);
    expect(apiMock).not.toHaveBeenCalled();
    expect(allText(none)).toContain(t.selectShopTitle);
  });
});
