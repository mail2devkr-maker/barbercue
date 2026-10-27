/// <reference types="jest" />
import { act, createElement } from 'react';
import { Text, TextInput } from 'react-native';
import TestRenderer from 'react-test-renderer';
import type { OwnerRevenueReportDto, SalonTimezoneResultDto } from '@barbercue/shared';
import OwnerRevenueReportScreen from '../OwnerRevenueReportScreen';
import { apiFetch } from '../../../lib/api';
import { dateKeyInTimezone, revenuePresetRange } from '../../../lib/owner-revenue-report';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => ({ selectedSalonId: 'salon-1', selectedSalon: { id: 'salon-1', name: 'Synthetic shop' } }) }));
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

const timezone: SalonTimezoneResultDto = {
  id: 'salon-1', timezone: 'Asia/Kolkata', countryCode: 'IN', timezoneAutoDetected: false,
  timezoneManuallyOverridden: true, suggestion: null,
};
const metric = {
  completedVisits: 2, grossServiceValue: 500, estimatedServiceValue: 500, invoiceCount: 1,
  invoiceDiscounts: 0, invoicedAmount: 500, recordedCollections: 400, refunds: 0,
  netRecordedCollections: 400,
};
const report: OwnerRevenueReportDto = {
  salonId: 'salon-1', currency: 'INR', timeZone: 'Asia/Kolkata', from: '2026-09-29', to: '2026-10-28',
  groupBy: 'day', source: null,
  periods: [{ ...metric, period: '2026-10-27' }],
  totals: metric,
  byService: [{ ...metric, key: 'service-1', label: 'Haircut', serviceId: 'service-1' }],
  byStaff: [{ ...metric, key: 'staff-1', label: 'Barber One', staffId: 'staff-1', identityVerified: true }],
  byCustomer: [],
  bySource: [{ ...metric, key: 'FASTQUE_APP', label: 'FastQue App', source: 'FASTQUE_APP' }],
  dataSemantics: {
    estimateBasis: 'BOOKING_PRICE_SNAPSHOT_AND_CURRENT_QUEUE_SERVICE_PRICE',
    cashSource: 'SHOP_RECORDED_INVOICE_PAYMENT_LEDGER',
    serviceCashAllocation: 'PRO_RATA_BY_INVOICE_LINE_TOTAL',
    externalAttribution: 'CAMPAIGN_TOKEN_WHEN_PRESENT_LEGACY_SOURCE_PROJECTION_OTHERWISE',
  },
};

let tree: ReturnType<typeof TestRenderer.create>;

function textOf(instance: any): string {
  return instance.children.map((child: any) => typeof child === 'string' ? child : textOf(child)).join('');
}

function renderedText(): string {
  return tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ');
}

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  (apiFetch as jest.Mock).mockImplementation((path: string) => Promise.resolve(path.endsWith('/timezone') ? timezone : report));
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

it('loads the selected salon timezone and server-authoritative collections without conflating estimates', async () => {
  await act(async () => { tree = TestRenderer.create(createElement(OwnerRevenueReportScreen, {} as never)); await flushEffects(); });

  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/timezone');
  const initialRange = revenuePresetRange('30d', dateKeyInTimezone('Asia/Kolkata'));
  expect(apiFetch).toHaveBeenCalledWith(`dashboard/salons/salon-1/revenue/report?from=${initialRange.from}&to=${initialRange.to}&groupBy=day`);
  expect(renderedText()).toContain('Recorded collections');
  expect(renderedText()).toContain('Net recorded collections');
  expect(renderedText()).toContain('Estimated service value');
  expect(renderedText()).toContain('it is not money collected.');
  expect(renderedText()).toContain('Haircut');
  expect(renderedText()).toContain('Barber One');
});

it('re-queries server data when weekly granularity or booking-source filters change', async () => {
  await act(async () => { tree = TestRenderer.create(createElement(OwnerRevenueReportScreen, {} as never)); await flushEffects(); });
  const weekly = tree.root.findAll((node: any) => node.props.accessibilityRole === 'tab' && textOf(node).includes('Weekly'))[0];
  await act(async () => { weekly.props.onPress(); await flushEffects(); });
  const initialRange = revenuePresetRange('30d', dateKeyInTimezone('Asia/Kolkata'));
  expect(apiFetch).toHaveBeenLastCalledWith(`dashboard/salons/salon-1/revenue/report?from=${initialRange.from}&to=${initialRange.to}&groupBy=week`);

  const instagram = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node).includes('Instagram'))[0];
  await act(async () => { instagram.props.onPress(); await flushEffects(); });
  expect(apiFetch).toHaveBeenLastCalledWith(`dashboard/salons/salon-1/revenue/report?from=${initialRange.from}&to=${initialRange.to}&groupBy=week&source=INSTAGRAM`);
});

it('validates custom dates before making an API request', async () => {
  await act(async () => { tree = TestRenderer.create(createElement(OwnerRevenueReportScreen, {} as never)); await flushEffects(); });
  const callsBefore = (apiFetch as jest.Mock).mock.calls.length;
  const inputs = tree.root.findAll((node: any) => node.type === TextInput);
  await act(async () => { inputs[0].props.onChangeText('2026-02-30'); });
  const apply = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node).includes('Show report'))[0];
  await act(async () => { apply.props.onPress(); await flushEffects(); });
  expect(renderedText()).toContain('Enter valid dates in YYYY-MM-DD format.');
  expect((apiFetch as jest.Mock).mock.calls).toHaveLength(callsBefore);
});

it('shows a truthful error instead of empty financial totals when report loading fails', async () => {
  (apiFetch as jest.Mock).mockImplementation((path: string) => path.endsWith('/timezone') ? Promise.resolve(timezone) : Promise.reject(new Error('offline')));
  await act(async () => { tree = TestRenderer.create(createElement(OwnerRevenueReportScreen, {} as never)); await flushEffects(); });

  expect(renderedText()).toContain('Could not load the revenue report. Please try again.');
  expect(renderedText()).not.toContain('₹400');
});
