/// <reference types="jest" />
import { act, createElement } from 'react';
import { Text } from 'react-native';
import TestRenderer from 'react-test-renderer';
import type { OwnerAnalyticsDto } from '@barbercue/shared';
import OwnerAnalyticsScreen from '../OwnerAnalyticsScreen';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => ({ selectedSalonId: 'salon-1', selectedSalon: { id: 'salon-1', name: 'Synthetic shop' } }) }));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN', t: {} }) }));
jest.mock('../../../lib/date-locale', () => ({ dateLocaleFor: () => 'en-IN' }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
}));
jest.mock('../../../components/ui', () => {
  const { createElement: el } = require('react');
  const { Text: NativeText, View: NativeView, Pressable: NativePressable } = require('react-native');
  return {
    EmptyState: ({ title, message }: any) => el(NativeView, null, el(NativeText, null, title), el(NativeText, null, message)),
    InlineError: ({ message }: any) => el(NativeText, null, message),
    PremiumCard: ({ children }: any) => el(NativeView, null, children),
    PremiumScreen: ({ children }: any) => el(NativeView, null, children),
    PremiumSectionHeader: ({ title, subtitle }: any) => el(NativeView, null, el(NativeText, null, title), el(NativeText, null, subtitle)),
    Skeleton: () => null,
  };
});

const analytics = {
  from: '2026-10-01T00:00:00.000Z', to: '2026-10-28T00:00:00.000Z', currency: 'INR',
  appointmentsBooked: 12, completedCount: 8, confirmedCount: 2, pendingPaymentCount: 0,
  cancelledCount: 1, noShowCount: 1, expiredCount: 0, walkInCount: 3, newCustomerCount: 4,
  repeatCustomerCount: 3, averageWaitMinutes: 12, averageServiceDurationMinutes: 25,
  barberUtilization: [], chairUtilization: [], peakHours: [], slowHours: [],
  servicePopularity: [], estimatedServiceValue: 1450,
  dailyServiceValue: [{ date: '2026-10-27', completedCount: 2, estimatedServiceValue: 500 }],
  serviceValue: [{ serviceId: 'service-1', name: 'Haircut', completedCount: 2, estimatedServiceValue: 500 }],
  barberValue: [], sourceMix: { bookingCompletedCount: 6, walkInCompletedCount: 2 },
  hourlyServiceValue: [], newCustomerEstimatedServiceValue: 500, repeatCustomerEstimatedServiceValue: 950,
  lostOpportunity: { cancelledEstimatedServiceValue: 100, noShowEstimatedServiceValue: 200, idleChairMinutes: null, idleChairPercent: null },
} as OwnerAnalyticsDto;

let tree: ReturnType<typeof TestRenderer.create>;

function textOf(instance: any): string {
  return instance.children.map((child: any) => typeof child === 'string' ? child : textOf(child)).join('');
}

function renderedText(): string {
  return tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ');
}

beforeEach(() => { jest.clearAllMocks(); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

it('loads salon-scoped analytics and clearly labels listed-price service value as an estimate', async () => {
  (apiFetch as jest.Mock).mockResolvedValue(analytics);
  await act(async () => { tree = TestRenderer.create(createElement(OwnerAnalyticsScreen, {} as never)); });

  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/analytics?range=30d');
  expect(renderedText()).toContain('Business analytics');
  expect(renderedText()).toContain('Estimated service value');
  expect(renderedText()).toContain('This is not recorded revenue or money collected.');
  expect(renderedText()).toContain('Haircut');
});

it('requests the newly selected range without changing the salon scope', async () => {
  (apiFetch as jest.Mock).mockResolvedValue(analytics);
  await act(async () => { tree = TestRenderer.create(createElement(OwnerAnalyticsScreen, {} as never)); });
  const sevenDays = tree.root.findAll((node: any) => node.props.accessibilityRole === 'tab' && textOf(node).includes('7 days'))[0];
  await act(async () => sevenDays.props.onPress());

  expect(apiFetch).toHaveBeenLastCalledWith('dashboard/salons/salon-1/analytics?range=7d');
});

it('shows an error instead of substituting empty or fabricated analytics when the API fails', async () => {
  (apiFetch as jest.Mock).mockRejectedValue(new Error('network unavailable'));
  await act(async () => { tree = TestRenderer.create(createElement(OwnerAnalyticsScreen, {} as never)); });

  expect(renderedText()).toContain('Could not load analytics. Please try again.');
  expect(renderedText()).not.toContain('₹1,450');
});

it('does not invent a currency when the salon has no currency configured', async () => {
  (apiFetch as jest.Mock).mockResolvedValue({ ...analytics, currency: null });
  await act(async () => { tree = TestRenderer.create(createElement(OwnerAnalyticsScreen, {} as never)); });

  expect(renderedText()).toContain('1,450');
  expect(renderedText()).not.toContain('₹');
});
