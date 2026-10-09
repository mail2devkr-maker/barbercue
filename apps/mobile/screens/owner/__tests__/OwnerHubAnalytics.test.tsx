/// <reference types="jest" />
jest.setTimeout(30_000);

import { act, createElement } from 'react';
import { formatMoney, uiStringsFor } from '@barbercue/shared';
import { allText, byTestId, byTestIdPrefix, flush, has, press, render } from '../../../lib/location/__fixtures__/render';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

let mockLanguage: 'EN' | 'HI' = 'EN';
jest.mock('../../../lib/language-context', () => {
  const { uiStringsFor: strings } = require('@barbercue/shared');
  return { useLanguage: () => ({ language: mockLanguage, setLanguage: jest.fn(), t: strings(mockLanguage) }) };
});

const mockSalon: { value: Record<string, unknown> } = { value: {} };
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => mockSalon.value }));

const mockNavigation = { navigate: jest.fn() };
jest.mock('@react-navigation/native', () => {
  const { useEffect } = require('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
    useNavigation: () => mockNavigation,
  };
});

jest.mock('../../../lib/api', () => {
  class MockApiError extends Error {
    status = 500;
    code = 'ERR';
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

import { apiFetch, ApiError } from '../../../lib/api';
import OwnerAnalyticsScreen from '../OwnerAnalyticsScreen';
import OwnerManageScreen from '../OwnerManageScreen';
import { OWNER_SECTIONS } from '../../../lib/owner/owner-sections';

const apiMock = apiFetch as jest.Mock;
const t = () => uiStringsFor(mockLanguage);

const SALON_A = { id: 'salon-a', name: 'Handsome Center', status: 'ACTIVE', isClosedForToday: false, isOwner: true };
const SALON_B = { id: 'salon-b', name: 'Second Shop', status: 'PENDING', isClosedForToday: false, isOwner: true };

function setSalon(selectedId: string | null, workplaces = [SALON_A, SALON_B]) {
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

const analytics = (over: Record<string, unknown> = {}) => ({
  from: '2026-10-09T00:00:00.000Z',
  to: '2026-10-10T00:00:00.000Z',
  currency: 'INR',
  appointmentsBooked: 13,
  completedCount: 4,
  confirmedCount: 1,
  pendingPaymentCount: 0,
  cancelledCount: 8,
  noShowCount: 0,
  expiredCount: 0,
  walkInCount: 1,
  newCustomerCount: 1,
  repeatCustomerCount: 2,
  averageWaitMinutes: 12,
  averageServiceDurationMinutes: 0.5,
  barberUtilization: [{ id: 'st1', displayName: 'Ravi', completedSessions: 3, totalServiceMinutes: 90 }],
  chairUtilization: [{ id: 'ch1', displayName: 'Chair 1', completedSessions: 3, totalServiceMinutes: 90 }],
  peakHours: [{ hour: 11, count: 4 }],
  slowHours: [{ hour: 16, count: 1 }],
  servicePopularity: [{ serviceId: 'sv1', name: 'Classic Haircut', completedCount: 3 }],
  estimatedServiceValue: 123456,
  dailyServiceValue: [
    { date: '2026-10-08', completedCount: 1, estimatedServiceValue: 400 },
    { date: '2026-10-09', completedCount: 3, estimatedServiceValue: 1200 },
  ],
  serviceValue: [{ serviceId: 'sv1', name: 'Classic Haircut', completedCount: 3, estimatedServiceValue: 1200 }],
  barberValue: [{ staffId: 'st1', displayName: 'Ravi', completedSessions: 3, estimatedServiceValue: 1200 }],
  sourceMix: { bookingCompletedCount: 3, walkInCompletedCount: 1 },
  hourlyServiceValue: Array.from({ length: 24 }, (_, hour) => ({ hour, completedCount: hour === 11 ? 3 : 0, estimatedServiceValue: hour === 11 ? 1200 : 0 })),
  newCustomerEstimatedServiceValue: 300,
  repeatCustomerEstimatedServiceValue: 900,
  lostOpportunity: { cancelledEstimatedServiceValue: 800, noShowEstimatedServiceValue: 0, idleChairMinutes: 480, idleChairPercent: 40 },
  ...over,
});

const TZ = { id: 'salon-a', timezone: 'Asia/Kolkata', countryCode: 'IN', timezoneAutoDetected: true, timezoneManuallyOverridden: false, suggestion: null };

function route(handlers: { analytics?: (path: string) => unknown; tz?: unknown }) {
  apiMock.mockImplementation(async (path: string) => {
    if (String(path).includes('/timezone')) {
      if (handlers.tz instanceof Error) throw handlers.tz;
      return handlers.tz ?? TZ;
    }
    if (String(path).includes('/analytics')) {
      const out = handlers.analytics ? handlers.analytics(String(path)) : analytics();
      if (out instanceof Error) throw out;
      return out;
    }
    throw new Error(`unexpected ${path}`);
  });
}
const tileText = (r: Awaited<ReturnType<typeof render>>, id: string) => {
  const node = byTestId(r, `analytics-tile-${id}`)[0];
  return `${node.props.label}: ${node.props.value}`;
};
const analyticsCalls = () => apiMock.mock.calls.map((c) => String(c[0])).filter((p) => p.includes('/analytics'));
const mountAnalytics = () => render(createElement(OwnerAnalyticsScreen as never));

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = 'EN';
  setSalon('salon-a');
});

describe('Owner management hub', () => {
  it('lists all 13 website sections as cards for the selected shop, in the website order', async () => {
    const r = await render(createElement(OwnerManageScreen as never));
    await flush();
    const ids = [...new Set(byTestIdPrefix(r, 'manage-section-').map((n) => String(n.props.testID)))];
    expect(ids).toEqual(OWNER_SECTIONS.map((s) => `manage-section-${s.id}`));
    expect(allText(r)).toContain('Handsome Center');
    expect(has(r, 'salon-switcher')).toBe(true);
  });

  it('opens existing tabs for Live queue and Bookings, and its own screen for every other section', async () => {
    const r = await render(createElement(OwnerManageScreen as never));
    await flush();
    for (const section of OWNER_SECTIONS) {
      mockNavigation.navigate.mockClear();
      await press(r, `manage-section-${section.id}`);
      if (section.target.kind === 'tab') expect(mockNavigation.navigate).toHaveBeenCalledWith(section.target.tab);
      else expect(mockNavigation.navigate).toHaveBeenCalledWith({ name: section.target.screen, params: undefined });
    }
  });

  it('shows Hindi labels', async () => {
    mockLanguage = 'HI';
    const r = await render(createElement(OwnerManageScreen as never));
    await flush();
    expect(allText(r)).toContain(uiStringsFor('HI').ownerSectionAnalytics);
    expect(allText(r)).toContain(uiStringsFor('HI').ownerManageTitle);
  });

  it('with no shop at all, says so instead of showing broken cards', async () => {
    setSalon(null, []);
    const r = await render(createElement(OwnerManageScreen as never));
    await flush();
    expect(allText(r)).toContain(t().noShopsYetTitle);
    expect(byTestIdPrefix(r, 'manage-section-')).toHaveLength(0);
  });
});

describe('Owner Analytics', () => {
  it('requests this shop\'s analytics for Today and renders the real figures, with shop-locale money', async () => {
    route({});
    const r = await mountAnalytics();
    await flush(6);
    expect(analyticsCalls()).toEqual(['dashboard/salons/salon-a/analytics?range=today']);
    const text = allText(r);
    expect(text).toContain('Handsome Center');
    for (const id of ['appointments', 'completed', 'confirmed', 'cancelled', 'walk-ins', 'new-customers', 'returning-customers', 'service-value']) {
      expect(has(r, `analytics-tile-${id}`)).toBe(true);
    }
    const tile = (id: string) => tileText(r, id);
    expect(tile('appointments')).toContain(': 13');
    expect(tile('completed')).toContain(': 4');
    expect(tile('cancelled')).toContain(': 8');
    expect(tile('avg-wait')).toContain(': 12m');
    expect(tile('avg-service')).toContain(': <1m');
    expect(tile('service-value')).toContain(formatMoney(123456, 'INR', 'IN')); // Indian grouping: ₹1,23,456
    expect(tile('service-value')).toContain('1,23,456');
    expect(text).toContain('Classic Haircut');
    expect(text).toContain('Ravi');
  });

  it('says plainly that dates and hours are in the shop\'s time zone', async () => {
    route({});
    const r = await mountAnalytics();
    await flush(6);
    expect(allText(r)).toContain(t().analyticsTimesIn.replace('{zone}', 'Asia/Kolkata'));
  });

  it('switching range reloads for that range only', async () => {
    route({});
    const r = await mountAnalytics();
    await flush(6);
    await press(r, 'analytics-range-7d');
    await flush(6);
    await press(r, 'analytics-range-30d');
    await flush(6);
    expect(analyticsCalls()).toEqual([
      'dashboard/salons/salon-a/analytics?range=today',
      'dashboard/salons/salon-a/analytics?range=7d',
      'dashboard/salons/salon-a/analytics?range=30d',
    ]);
    expect(has(r, 'analytics-range-custom')).toBe(false);
  });

  it('Sales & value view draws the trend, ranked values and both splits from the same payload (no refetch)', async () => {
    route({});
    const r = await mountAnalytics();
    await flush(6);
    const before = analyticsCalls().length;
    await press(r, 'analytics-view-value');
    expect(analyticsCalls().length).toBe(before);
    expect(has(r, 'column-chart')).toBe(true);
    expect(has(r, 'column-2026-10-09')).toBe(true);
    expect(byTestId(r, 'column-2026-10-09')[0].props.accessibilityLabel).toContain(formatMoney(1200, 'INR', 'IN'));
    expect(has(r, 'ranked-sv1')).toBe(true);
    expect(has(r, 'ranked-st1')).toBe(true);
    expect(byTestIdPrefix(r, 'split-bar').length).toBeGreaterThan(0);
    expect(allText(r)).toContain(t().analyticsValueTrendSub); // "not audited payment revenue"
  });

  it('Operations view shows 24 hourly cells, lost-opportunity tiles and busiest/slowest hours', async () => {
    route({});
    const r = await mountAnalytics();
    await flush(6);
    await press(r, 'analytics-view-operations');
    expect(byTestIdPrefix(r, 'heat-').filter((n) => /^heat-\d+$/.test(String(n.props.testID)))).toHaveLength(24);
    expect(tileText(r, 'cancelled-value')).toContain('₹800');
    expect(tileText(r, 'lost-total')).toContain('₹800');
    expect(tileText(r, 'idle-chair')).toContain('8h');
    expect(allText(r)).toContain('Busiest: 11 AM (4)');
    expect(allText(r)).toContain('Slowest: 4 PM (1)');
  });

  it('handles an empty report with honest empty messages, never fabricated numbers', async () => {
    route({
      analytics: () =>
        analytics({
          appointmentsBooked: 0, completedCount: 0, confirmedCount: 0, cancelledCount: 0, walkInCount: 0, newCustomerCount: 0, repeatCustomerCount: 0,
          averageWaitMinutes: null, averageServiceDurationMinutes: null, estimatedServiceValue: 0,
          servicePopularity: [], barberUtilization: [], chairUtilization: [], dailyServiceValue: [], serviceValue: [], barberValue: [], peakHours: [], slowHours: [],
          sourceMix: { bookingCompletedCount: 0, walkInCompletedCount: 0 },
          lostOpportunity: { cancelledEstimatedServiceValue: 0, noShowEstimatedServiceValue: 0, idleChairMinutes: null, idleChairPercent: null },
        }),
    });
    const r = await mountAnalytics();
    await flush(6);
    expect(tileText(r, 'avg-wait')).toContain('—');
    expect(allText(r)).toContain(t().analyticsNoCompletedServices);
    await press(r, 'analytics-view-value');
    expect(allText(r)).toContain(t().analyticsNoServiceValue);
    await press(r, 'analytics-view-operations');
    expect(allText(r)).toContain(t().analyticsNotEnoughBookings);
    expect(allText(r)).toContain(t().analyticsIdleNeedsHours);
  });

  it('a server refusal (e.g. not your shop) shows its message and no data; Retry works', async () => {
    let fail = true;
    route({
      analytics: () => {
        if (fail) return new (ApiError as never as new (m: string) => Error)('You do not have access to this shop.');
        return analytics();
      },
    });
    const r = await mountAnalytics();
    await flush(6);
    expect(has(r, 'analytics-error')).toBe(true);
    expect(allText(r)).toContain('You do not have access to this shop.');
    expect(byTestIdPrefix(r, 'analytics-tile-')).toHaveLength(0);
    fail = false;
    const retryButton = r.root.findAll((n: { props: Record<string, unknown> }) => n.props.title === t().analyticsRetry && typeof n.props.onPress === 'function')[0];
    await act(async () => (retryButton.props.onPress as () => void)());
    await flush(6);
    expect(has(r, 'analytics-error')).toBe(false);
    expect(has(r, 'analytics-tile-completed')).toBe(true);
  });

  it('a generic failure falls back to the translated message', async () => {
    route({ analytics: () => new Error('boom') });
    const r = await mountAnalytics();
    await flush(6);
    expect(allText(r)).toContain(t().analyticsLoadFailed);
  });

  it('switching shops loads the new shop and never leaves the old shop\'s numbers visible (multi-shop isolation)', async () => {
    let releaseA!: (value: unknown) => void;
    route({
      analytics: (path) => {
        if (path.includes('salon-a')) return new Promise((resolve) => (releaseA = resolve));
        return analytics({ appointmentsBooked: 77 });
      },
    });
    const r = await mountAnalytics();
    await flush(3);
    setSalon('salon-b');
    await act(async () => r.update(createElement(OwnerAnalyticsScreen as never)));
    await flush(6);
    expect(analyticsCalls()).toEqual(['dashboard/salons/salon-a/analytics?range=today', 'dashboard/salons/salon-b/analytics?range=today']);
    expect(tileText(r, 'appointments')).toContain(': 77');
    // Shop A's slow answer finally arrives: it must be ignored.
    await act(async () => releaseA(analytics({ appointmentsBooked: 999 })));
    await flush(4);
    expect(tileText(r, 'appointments')).toContain(': 77');
    expect(allText(r)).toContain('Second Shop');
  });

  it('works without a time zone answer (note hidden, figures still shown)', async () => {
    route({ tz: new Error('unavailable') });
    const r = await mountAnalytics();
    await flush(6);
    expect(has(r, 'analytics-tile-completed')).toBe(true);
    expect(has(r, 'analytics-timezone')).toBe(false);
  });

  it('asks to choose a shop when none is selected and makes no request', async () => {
    setSalon(null);
    const r = await mountAnalytics();
    await flush(4);
    expect(apiMock).not.toHaveBeenCalled();
    expect(allText(r)).toContain(t().selectShopTitle);
  });

  it('renders in Hindi', async () => {
    mockLanguage = 'HI';
    route({});
    const r = await mountAnalytics();
    await flush(6);
    expect(allText(r)).toContain(uiStringsFor('HI').analyticsTitle);
    expect(allText(r)).toContain(uiStringsFor('HI').analyticsRangeToday);
    expect(uiStringsFor('HI').analyticsServiceValue).not.toBe(uiStringsFor('EN').analyticsServiceValue);
  });
});
