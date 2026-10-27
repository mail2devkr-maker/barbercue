/// <reference types="jest" />
import { act, createElement } from 'react';
import { Text } from 'react-native';
import TestRenderer from 'react-test-renderer';
import type { CancellationAnalyticsDto } from '@barbercue/shared';
import OwnerCancellationsScreen from '../OwnerCancellationsScreen';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => ({ selectedSalonId: 'salon / 1', selectedSalon: { id: 'salon / 1', name: 'Synthetic shop' } }) }));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN', t: {} }) }));
jest.mock('../../../lib/date-locale', () => ({ dateLocaleFor: () => 'en-IN' }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
}));
jest.mock('../../../components/ui', () => {
  const { createElement: el } = require('react');
  const { Text: NativeText, View: NativeView } = require('react-native');
  return {
    EmptyState: ({ title, message }: any) => el(NativeView, null, el(NativeText, null, title), el(NativeText, null, message)),
    InlineError: ({ message }: any) => el(NativeText, null, message),
    PremiumCard: ({ children }: any) => el(NativeView, null, children),
    PremiumScreen: ({ children }: any) => el(NativeView, null, children),
    PremiumSectionHeader: ({ title, subtitle }: any) => el(NativeView, null, el(NativeText, null, title), el(NativeText, null, subtitle)),
    Skeleton: () => null,
  };
});

const cancellationData: CancellationAnalyticsDto = {
  from: '2026-10-01T00:00:00.000Z', to: '2026-10-28T00:00:00.000Z', currency: 'INR',
  totalCancellations: 2, totalBookings: 10, cancellationRatePercent: 20,
  byActor: { CUSTOMER: 1, OWNER: 0, STAFF: 0, SYSTEM: 0, ADMIN: 0, UNKNOWN: 1 },
  byService: [{ key: 'service-1', label: 'Haircut', count: 2 }],
  byReason: [{ key: 'schedule', label: 'Schedule conflict', count: 1 }],
  charges: { charged: 250, waived: 50, outstanding: 100, settled: 100 },
  rows: [{
    bookingId: 'booking-1', cancelledAt: '2026-10-27T09:00:00.000Z', slotStart: '2026-10-28T11:00:00.000Z',
    actor: 'UNKNOWN', reason: null, serviceNames: ['Haircut'], chargeAmount: null, chargeStatus: null,
  }],
  liveQueue: { cancelled: 3, expired: 2, noShow: 1 }, unattributedCount: 1,
};

let tree: ReturnType<typeof TestRenderer.create>;

function textOf(instance: any): string {
  return instance.children.map((child: any) => typeof child === 'string' ? child : textOf(child)).join('');
}

function renderedText(): string {
  return tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ');
}

beforeEach(() => { jest.clearAllMocks(); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

it('loads only the selected shop path and keeps booking charges and Live Queue outcomes explicit', async () => {
  (apiFetch as jest.Mock).mockResolvedValue(cancellationData);
  await act(async () => { tree = TestRenderer.create(createElement(OwnerCancellationsScreen, {} as never)); });

  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon%20%2F%201/analytics/cancellations?range=30d');
  expect(renderedText()).toContain('Cancellation rate');
  expect(renderedText()).toContain('Customer');
  expect(renderedText()).toContain('Not recorded');
  expect(renderedText()).toContain('Live Queue (separate)');
  expect(renderedText()).toContain('Live Queue outcomes are separate from booking cancellation totals.');
  expect(renderedText()).toContain('Outstanding');
  expect(renderedText()).toContain('Haircut');
});

it('applies period and actor filters without changing the selected shop', async () => {
  (apiFetch as jest.Mock).mockResolvedValue(cancellationData);
  await act(async () => { tree = TestRenderer.create(createElement(OwnerCancellationsScreen, {} as never)); });
  const ninetyDays = tree.root.findAll((node: any) => node.props.accessibilityRole === 'tab' && textOf(node).includes('90 days'))[0];
  await act(async () => ninetyDays.props.onPress());
  const unknown = tree.root.findAll((node: any) => node.props.accessibilityRole === 'tab' && textOf(node).includes('Not recorded'))[0];
  await act(async () => unknown.props.onPress());

  expect(apiFetch).toHaveBeenLastCalledWith('dashboard/salons/salon%20%2F%201/analytics/cancellations?range=90d&actor=UNKNOWN');
});

it('shows an unavailable rate as a dash when no bookings exist', async () => {
  (apiFetch as jest.Mock).mockResolvedValue({ ...cancellationData, totalCancellations: 0, totalBookings: 0, cancellationRatePercent: null, rows: [] });
  await act(async () => { tree = TestRenderer.create(createElement(OwnerCancellationsScreen, {} as never)); });

  expect(renderedText()).toContain('No bookings were made in this period, so a rate is unavailable.');
  expect(renderedText()).toContain('No cancelled bookings match this period and filter.');
});

it('renders an API error rather than inventing cancellation data', async () => {
  (apiFetch as jest.Mock).mockRejectedValue(new Error('network unavailable'));
  await act(async () => { tree = TestRenderer.create(createElement(OwnerCancellationsScreen, {} as never)); });

  expect(renderedText()).toContain('Could not load cancellation analytics. Please try again.');
  expect(renderedText()).not.toContain('Haircut');
});
