/// <reference types="jest" />
import { act, createElement } from 'react';
import { Text } from 'react-native';
import TestRenderer from 'react-test-renderer';
import type { InvoiceDetailDto, InvoiceListDto } from '@barbercue/shared';
import OwnerInvoicesScreen from '../OwnerInvoicesScreen';
import OwnerInvoiceDetailScreen from '../OwnerInvoiceDetailScreen';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => ({ selectedSalonId: 'salon-1', selectedSalon: { id: 'salon-1', name: 'Synthetic shop' } }) }));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN', t: { loadMore: 'Load more' } }) }));
jest.mock('../../../lib/date-locale', () => ({ dateLocaleFor: () => 'en-IN' }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, []),
}));
jest.mock('../../../components/ui', () => {
  const { createElement: el } = require('react');
  const { Text: NativeText, View: NativeView, Pressable: NativePressable } = require('react-native');
  return {
    Card: ({ children }: any) => el(NativeView, null, children),
    EmptyState: ({ title, message }: any) => el(NativeView, null, el(NativeText, null, title), el(NativeText, null, message)),
    InlineError: ({ message }: any) => el(NativeText, null, message),
    Screen: ({ children }: any) => el(NativeView, null, children),
    SectionHeader: ({ title, subtitle }: any) => el(NativeView, null, el(NativeText, null, title), el(NativeText, null, subtitle)),
    Skeleton: () => null,
    Button: ({ title, onPress }: any) => el(NativePressable, { onPress }, el(NativeText, null, title)),
  };
});

const invoiceSummary = {
  id: 'invoice-1', number: 'FQ-0001', salonId: 'salon-1', sourceType: 'BOOKING', bookingId: 'booking-1', queueEntryId: null,
  customerName: 'Synthetic customer', currency: 'INR', total: 240, amountPaid: 100, amountRefunded: 0, balanceDue: 140,
  paymentStatus: 'PARTIALLY_PAID', status: 'ISSUED', issuedAt: '2026-10-26T00:00:00.000Z', serviceDate: '2026-10-27T00:00:00.000Z',
};

let tree: ReturnType<typeof TestRenderer.create>;
const navigate = jest.fn();

function textOf(instance: any): string {
  return instance.children.map((child: any) => typeof child === 'string' ? child : textOf(child)).join('');
}

beforeEach(() => { jest.clearAllMocks(); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

it('requests invoices using the selected salon scope and opens details with that same scope', async () => {
  (apiFetch as jest.Mock).mockResolvedValue({ items: [invoiceSummary], nextCursor: null } as InvoiceListDto);
  await act(async () => {
    tree = TestRenderer.create(createElement(OwnerInvoicesScreen, { navigation: { navigate } } as never));
  });
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/invoices?limit=20');
  expect(tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ')).toContain('FQ-0001');
  const row = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes('FQ-0001'))[0];
  await act(async () => row.props.onPress());
  expect(navigate).toHaveBeenCalledWith('OwnerInvoiceDetail', { salonId: 'salon-1', invoiceId: 'invoice-1' });
});

it('loads detail only through the salon-scoped owner endpoint and renders recorded values', async () => {
  const detail = {
    ...invoiceSummary, salonName: 'Synthetic shop', customerPhone: null, staffName: null, subtotal: 240,
    discountTotal: 0, taxTotal: 0, taxLabel: null, taxRatePercent: null, taxMode: null,
    seller: { legalName: 'Synthetic shop', gstin: null, address: null, phone: null, email: null },
    lines: [{ id: 'line-1', description: 'Synthetic haircut', quantity: 1, unitPrice: 240, discount: 0, lineTotal: 240 }],
    payments: [{ id: 'payment-1', kind: 'PAYMENT', method: 'CASH', amount: 100, reference: null, note: null, recordedAt: '2026-10-27T00:00:00.000Z' }],
    voidReason: null,
  } as InvoiceDetailDto;
  (apiFetch as jest.Mock).mockResolvedValue(detail);
  await act(async () => {
    tree = TestRenderer.create(createElement(OwnerInvoiceDetailScreen, { route: { params: { salonId: 'salon-1', invoiceId: 'invoice-1' } } } as never));
  });
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/invoices/invoice-1');
  const output = tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ');
  expect(output).toContain('Recorded payments');
  expect(output).toContain('This screen does not collect payments');
});
