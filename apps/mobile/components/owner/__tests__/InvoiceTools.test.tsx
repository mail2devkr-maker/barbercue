import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { InvoiceDetailDto } from '@barbercue/shared';
import { BillingProfileEditor, CreateInvoiceButton, InvoiceDetailActions, parseProfileForm } from '../InvoiceTools';
import { apiDownloadFile, apiFetch } from '../../../lib/api';
import * as Sharing from 'expo-sharing';

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  apiDownloadFile: jest.fn(),
  ApiError: class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) }));
let mockKey = 0;
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => `key-${++mockKey}` }));
jest.mock('../../ui', () => {
  const { Pressable, Text, View } = require('react-native');
  const { createElement } = require('react');
  return {
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) =>
      createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, disabled, onPress }, createElement(Text, null, title)),
    Card: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
  };
});

const fetchMock = apiFetch as jest.Mock;
const base = 'dashboard/salons/salon-1';
const invoice: InvoiceDetailDto = {
  id: 'inv-1', number: 'INV/2026/7', salonId: 'salon-1', sourceType: 'BOOKING', bookingId: 'b-1', queueEntryId: null,
  customerName: 'Synthetic Customer', currency: 'INR', total: 500, amountPaid: 200, amountRefunded: 0, balanceDue: 300,
  paymentStatus: 'PARTIALLY_PAID' as InvoiceDetailDto['paymentStatus'], status: 'ISSUED', issuedAt: '2026-11-01T00:00:00.000Z', serviceDate: '2026-11-01T00:00:00.000Z',
  salonName: 'Synthetic Salon', customerPhone: null, staffName: null, subtotal: 500, discountTotal: 0, taxTotal: 0, taxLabel: null,
  taxRatePercent: null, taxMode: null, seller: { legalName: 'Synthetic Pvt', gstin: null, address: null, phone: null, email: null },
  lines: [], payments: [], voidReason: null,
};

beforeEach(() => {
  fetchMock.mockReset();
  (apiDownloadFile as jest.Mock).mockReset();
  mockKey = 0;
});

describe('InvoiceDetailActions', () => {
  it('downloads the PDF from the owner-scoped endpoint and opens the share sheet', async () => {
    (apiDownloadFile as jest.Mock).mockResolvedValue('file:///cache/INV-2026-7.pdf');
    await render(<InvoiceDetailActions base={base} invoice={invoice} language={'EN' as never} onChanged={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Download / share PDF'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/INV-2026-7.pdf', expect.objectContaining({ mimeType: 'application/pdf' })));
    expect(apiDownloadFile).toHaveBeenCalledWith(`${base}/invoices/inv-1/pdf`, 'INV/2026/7.pdf');
  });

  it('records a payment with the shared schema and reuses the idempotency key on a retry of the same values', async () => {
    const onChanged = jest.fn();
    fetchMock.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({});
    await render(<InvoiceDetailActions base={base} invoice={invoice} language={'EN' as never} onChanged={onChanged} />);
    await fireEvent.press(screen.getByLabelText('Record payment'));
    expect(screen.getByLabelText('Amount').props.value).toBe('300');
    await fireEvent.press(screen.getByText('UPI'));
    await fireEvent.press(screen.getAllByLabelText('Record payment')[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getAllByLabelText('Record payment')[0]);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Payment recorded.'));
    const [first, second] = fetchMock.mock.calls;
    expect(first[0]).toBe(`${base}/invoices/inv-1/payments`);
    expect(JSON.parse(first[1].body)).toMatchObject({ kind: 'PAYMENT', method: 'UPI', amount: 300 });
    expect(first[1].headers['Idempotency-Key']).toBe(second[1].headers['Idempotency-Key']);
  });

  it('rejects an invalid amount before calling the server', async () => {
    await render(<InvoiceDetailActions base={base} invoice={invoice} language={'EN' as never} onChanged={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Record payment'));
    await fireEvent.changeText(screen.getByLabelText('Amount'), '0');
    await fireEvent.press(screen.getAllByLabelText('Record payment')[0]);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers a refund only for money already received, and voids only after an explicit confirmation', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    fetchMock.mockResolvedValue({});
    const onChanged = jest.fn();
    await render(<InvoiceDetailActions base={base} invoice={invoice} language={'EN' as never} onChanged={onChanged} />);
    expect(screen.getByLabelText('Record refund')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Void invoice'));
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'Created by mistake');
    await fireEvent.press(screen.getAllByLabelText('Void invoice')[0]);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Invoice voided.'));
    expect(alertSpy).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(`${base}/invoices/inv-1/void`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'Created by mistake' }) }));
    alertSpy.mockRestore();
  });

  it('shows no write actions on a voided invoice', async () => {
    await render(<InvoiceDetailActions base={base} invoice={{ ...invoice, status: 'VOID', voidReason: 'Duplicate' }} language={'EN' as never} onChanged={jest.fn()} />);
    expect(screen.queryByLabelText('Record payment')).toBeNull();
    expect(screen.queryByLabelText('Void invoice')).toBeNull();
    expect(screen.getByText('Voided: Duplicate')).toBeTruthy();
  });
});

describe('BillingProfileEditor', () => {
  it('loads the profile and saves it through the shared schema', async () => {
    fetchMock.mockImplementation((path: string, options?: { method?: string; body?: string }) =>
      Promise.resolve(options?.method === 'PUT'
        ? { ...JSON.parse(options.body ?? '{}'), salonId: 'salon-1', complete: true, taxRatePercent: null, billingAddress: null, contactPhone: null, contactEmail: null, gstin: null }
        : { salonId: 'salon-1', legalName: null, billingAddress: null, contactPhone: null, contactEmail: null, gstin: null, taxEnabled: false, taxLabel: 'GST', taxRatePercent: null, taxMode: 'EXCLUSIVE', invoicePrefix: 'INV', complete: false }));
    await render(<BillingProfileEditor base={base} language={'EN' as never} />);
    expect(await screen.findByText(/Add your business name/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Legal / business name'), 'Synthetic Salon Pvt');
    await fireEvent.press(screen.getByLabelText('Save billing profile'));
    await waitFor(() => expect(screen.getByText(/Billing profile saved/)).toBeTruthy());
    const put = fetchMock.mock.calls.find(([, o]) => o?.method === 'PUT');
    expect(put[0]).toBe(`${base}/billing-profile`);
    expect(JSON.parse(put[1].body)).toMatchObject({ legalName: 'Synthetic Salon Pvt', taxEnabled: false, invoicePrefix: 'INV' });
  });

  it('requires a tax rate when tax is on (same rule as the website)', async () => {
    const parsed = parseProfileForm({ legalName: 'Shop', billingAddress: '', contactPhone: '', contactEmail: '', gstin: '', taxEnabled: true, taxLabel: 'GST', taxRatePercent: '', taxMode: 'EXCLUSIVE', invoicePrefix: 'INV' });
    expect(parsed.success).toBe(false);
  });
});

describe('CreateInvoiceButton', () => {
  it('creates an invoice for a completed booking once, then opens it', async () => {
    const created = { ...invoice, id: 'inv-9', number: 'INV-9' };
    fetchMock.mockImplementation((path: string, options?: { method?: string }) =>
      Promise.resolve(path.includes('by-source') ? null : options?.method === 'POST' ? created : null));
    const onOpen = jest.fn();
    await render(<CreateInvoiceButton base={base} bookingId="b-1" language={'EN' as never} onOpen={onOpen} />);
    await fireEvent.press(await screen.findByLabelText('Create invoice'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(created));
    const post = fetchMock.mock.calls.find(([, o]) => o?.method === 'POST');
    expect(JSON.parse(post[1].body)).toEqual({ bookingId: 'b-1' });
    expect(post[1].headers['Idempotency-Key']).toBeTruthy();
    expect(await screen.findByLabelText('Invoice INV-9')).toBeTruthy();
  });

  it('links to an existing invoice instead of offering to create a second one', async () => {
    fetchMock.mockResolvedValue({ ...invoice, number: 'INV-3' });
    await render(<CreateInvoiceButton base={base} queueEntryId="q-1" language={'EN' as never} />);
    expect(await screen.findByLabelText('Invoice INV-3')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`${base}/invoices/by-source?queueEntryId=q-1`);
  });
});
