/// <reference types="jest" />
import { act, createElement } from 'react';
import { Alert, Text, TextInput } from 'react-native';
import TestRenderer from 'react-test-renderer';
import type { InvoiceDetailDto, InvoiceListDto } from '@barbercue/shared';
import OwnerInvoicesScreen from '../OwnerInvoicesScreen';
import OwnerInvoiceDetailScreen from '../OwnerInvoiceDetailScreen';
import { apiFetch } from '../../../lib/api';
import { shareOwnerFile } from '../../../lib/owner-file-share';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/owner-file-share', () => ({ shareOwnerFile: jest.fn() }));
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => 'invoice-payment-key' }));
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => ({ selectedSalonId: 'salon-1', selectedSalon: { id: 'salon-1', name: 'Synthetic shop' } }) }));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN', t: { loadMore: 'Load more' } }) }));
jest.mock('../../../lib/date-locale', () => ({ dateLocaleFor: () => 'en-IN' }));
jest.mock('react-native', () => {
  const React = require('react');
  const native = jest.requireActual('react-native');
  const MockFlatList = ({ data, renderItem, ListHeaderComponent, ListFooterComponent }: any) =>
    React.createElement(
      native.View,
      null,
      ListHeaderComponent,
      ...data.map((item: unknown, index: number) => renderItem({ item, index })),
      ListFooterComponent,
    );
  return new Proxy(native, {
    get(target, property, receiver) {
      if (property === 'Platform') return { ...native.Platform, OS: 'ios' };
      return property === 'FlatList' ? MockFlatList : Reflect.get(target, property, receiver);
    },
  });
});
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

it('shares an invoice PDF using the same salon-scoped invoice identity', async () => {
  const detail = {
    ...invoiceSummary, salonName: 'Synthetic shop', customerPhone: null, staffName: null, subtotal: 240,
    discountTotal: 0, taxTotal: 0, taxLabel: null, taxRatePercent: null, taxMode: null,
    seller: { legalName: 'Synthetic shop', gstin: null, address: null, phone: null, email: null },
    lines: [], payments: [], voidReason: null,
  } as InvoiceDetailDto;
  (apiFetch as jest.Mock).mockResolvedValue(detail);
  (shareOwnerFile as jest.Mock).mockResolvedValue(undefined);
  await act(async () => {
    tree = TestRenderer.create(createElement(OwnerInvoiceDetailScreen, { route: { params: { salonId: 'salon-1', invoiceId: 'invoice-1' } } } as never));
  });

  const shareButton = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes('Share invoice PDF'))[0];
  expect(shareButton).toBeDefined();
  await act(async () => { shareButton.props.onPress(); await Promise.resolve(); });

  expect(shareOwnerFile).toHaveBeenCalledWith({
    kind: 'pdf',
    path: 'dashboard/salons/salon-1/invoices/invoice-1/pdf',
    fileName: 'FQ-0001.pdf',
    contentType: 'application/pdf',
  });
});

it('records only a confirmed actual receipt through the salon-scoped idempotent API and trusts its response', async () => {
  const detail = {
    ...invoiceSummary, salonName: 'Synthetic shop', customerPhone: null, staffName: null, subtotal: 240,
    discountTotal: 0, taxTotal: 0, taxLabel: null, taxRatePercent: null, taxMode: null,
    seller: { legalName: 'Synthetic shop', gstin: null, address: null, phone: null, email: null },
    lines: [], payments: [], voidReason: null,
  } as InvoiceDetailDto;
  const updated = { ...detail, amountPaid: 240, balanceDue: 0, paymentStatus: 'PAID' } as InvoiceDetailDto;
  (apiFetch as jest.Mock).mockResolvedValueOnce(detail).mockResolvedValueOnce(updated);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    await act(async () => {
      tree = TestRenderer.create(createElement(OwnerInvoiceDetailScreen, { route: { params: { salonId: 'salon-1', invoiceId: 'invoice-1' } } } as never));
    });
    const recordButton = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes('Record received payment'))[0];
    await act(async () => recordButton.props.onPress());
    const amount = tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Amount');
    expect(amount).toBeDefined();
    await act(async () => amount!.props.onChangeText('140'));
    const upi = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'UPI')[0];
    await act(async () => upi.props.onPress());
    const submit = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes('Review record'))[0];
    await act(async () => submit.props.onPress());
    expect(alert).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('actually received by the shop'), expect.any(Array));
    const confirm = alert.mock.calls[0]?.[2]?.[1] as { onPress: () => void };
    await act(async () => confirm.onPress());
    expect(apiFetch).toHaveBeenLastCalledWith('dashboard/salons/salon-1/invoices/invoice-1/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'invoice-payment-key' },
      body: JSON.stringify({ kind: 'PAYMENT', method: 'UPI', amount: 140 }),
    });
    expect(tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ')).toContain('Payment record saved.');
    expect(tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ')).toContain('Balance due');
  } finally {
    alert.mockRestore();
  }
});

it('blocks a payment amount greater than the server-reported invoice balance before confirmation', async () => {
  const detail = {
    ...invoiceSummary, salonName: 'Synthetic shop', customerPhone: null, staffName: null, subtotal: 240,
    discountTotal: 0, taxTotal: 0, taxLabel: null, taxRatePercent: null, taxMode: null,
    seller: { legalName: 'Synthetic shop', gstin: null, address: null, phone: null, email: null },
    lines: [], payments: [], voidReason: null,
  } as InvoiceDetailDto;
  (apiFetch as jest.Mock).mockResolvedValueOnce(detail);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    await act(async () => {
      tree = TestRenderer.create(createElement(OwnerInvoiceDetailScreen, { route: { params: { salonId: 'salon-1', invoiceId: 'invoice-1' } } } as never));
    });
    const recordButton = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes('Record received payment'))[0];
    await act(async () => recordButton.props.onPress());
    const amount = tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Amount');
    await act(async () => amount!.props.onChangeText('141'));
    const submit = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes('Review record'))[0];
    await act(async () => submit.props.onPress());
    expect(alert).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ')).toContain('Amount cannot exceed the remaining balance.');
  } finally {
    alert.mockRestore();
  }
});

it('records a refund only after explicit confirmation that the money was actually returned', async () => {
  const detail = {
    ...invoiceSummary, salonName: 'Synthetic shop', customerPhone: null, staffName: null, subtotal: 240,
    discountTotal: 0, taxTotal: 0, taxLabel: null, taxRatePercent: null, taxMode: null,
    seller: { legalName: 'Synthetic shop', gstin: null, address: null, phone: null, email: null },
    lines: [], payments: [], voidReason: null,
  } as InvoiceDetailDto;
  const updated = { ...detail, amountRefunded: 40, paymentStatus: 'PARTIALLY_PAID' } as InvoiceDetailDto;
  (apiFetch as jest.Mock).mockResolvedValueOnce(detail).mockResolvedValueOnce(updated);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    await act(async () => {
      tree = TestRenderer.create(createElement(OwnerInvoiceDetailScreen, { route: { params: { salonId: 'salon-1', invoiceId: 'invoice-1' } } } as never));
    });
    const recordRefund = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes('Record paid-out refund'))[0];
    await act(async () => recordRefund.props.onPress());
    const amount = tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Amount');
    await act(async () => amount!.props.onChangeText('40'));
    const submit = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes('Review record'))[0];
    await act(async () => submit.props.onPress());
    expect(alert).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('actually returned to the customer'), expect.any(Array));
    const confirm = alert.mock.calls[0]?.[2]?.[1] as { onPress: () => void };
    await act(async () => confirm.onPress());
    const body = JSON.parse((apiFetch as jest.Mock).mock.calls[1]?.[1]?.body as string);
    expect(apiFetch).toHaveBeenLastCalledWith('dashboard/salons/salon-1/invoices/invoice-1/payments', expect.objectContaining({ method: 'POST' }));
    expect(body).toEqual({ kind: 'REFUND', method: 'CASH', amount: 40 });
  } finally {
    alert.mockRestore();
  }
});

it('voids an invoice only after a reason and explicit confirmation, preserving server response and idempotency', async () => {
  const detail = {
    ...invoiceSummary, amountPaid: 0, balanceDue: 240, paymentStatus: 'UNPAID', salonName: 'Synthetic shop', customerPhone: null, staffName: null, subtotal: 240,
    discountTotal: 0, taxTotal: 0, taxLabel: null, taxRatePercent: null, taxMode: null,
    seller: { legalName: 'Synthetic shop', gstin: null, address: null, phone: null, email: null },
    lines: [], payments: [], voidReason: null,
  } as InvoiceDetailDto;
  const updated = { ...detail, status: 'VOID', paymentStatus: 'VOID', voidReason: 'Duplicate issued in error' } as InvoiceDetailDto;
  (apiFetch as jest.Mock).mockResolvedValueOnce(detail).mockResolvedValueOnce(updated);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    await act(async () => {
      tree = TestRenderer.create(createElement(OwnerInvoiceDetailScreen, { route: { params: { salonId: 'salon-1', invoiceId: 'invoice-1' } } } as never));
    });
    const openVoid = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Void invoice')[0];
    await act(async () => openVoid.props.onPress());
    const reason = tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Reason');
    expect(reason).toBeDefined();
    await act(async () => reason!.props.onChangeText('Duplicate issued in error'));
    const review = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Review void')[0];
    await act(async () => review.props.onPress());
    expect(alert).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('keep its number on record'), expect.any(Array));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const confirm = alert.mock.calls[0]?.[2]?.[1] as { onPress: () => void };
    await act(async () => confirm.onPress());
    expect(apiFetch).toHaveBeenLastCalledWith('dashboard/salons/salon-1/invoices/invoice-1/void', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'invoice-payment-key' },
      body: JSON.stringify({ reason: 'Duplicate issued in error' }),
    });
    expect(tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ')).toContain('Invoice voided. Its number and audit history remain on record.');
    expect(tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ')).toContain('Voided: Duplicate issued in error. The invoice number remains on record.');
  } finally {
    alert.mockRestore();
  }
});

it('rejects an invalid void reason locally and never calls the mutation endpoint', async () => {
  const detail = {
    ...invoiceSummary, salonName: 'Synthetic shop', customerPhone: null, staffName: null, subtotal: 240,
    discountTotal: 0, taxTotal: 0, taxLabel: null, taxRatePercent: null, taxMode: null,
    seller: { legalName: 'Synthetic shop', gstin: null, address: null, phone: null, email: null },
    lines: [], payments: [], voidReason: null,
  } as InvoiceDetailDto;
  (apiFetch as jest.Mock).mockResolvedValueOnce(detail);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    await act(async () => {
      tree = TestRenderer.create(createElement(OwnerInvoiceDetailScreen, { route: { params: { salonId: 'salon-1', invoiceId: 'invoice-1' } } } as never));
    });
    const openVoid = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Void invoice')[0];
    await act(async () => openVoid.props.onPress());
    const review = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Review void')[0];
    await act(async () => review.props.onPress());
    expect(alert).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ')).toContain('String must contain at least 3 character(s)');
  } finally {
    alert.mockRestore();
  }
});
