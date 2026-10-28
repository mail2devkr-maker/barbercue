/// <reference types="jest" />
import { act, createElement } from 'react';
import { Alert } from 'react-native';
import TestRenderer from 'react-test-renderer';
import type { InvoiceDetailDto } from '@barbercue/shared';
import { apiFetch } from '../../../lib/api';
import { CompletedBookingInvoiceAction } from '../CompletedBookingInvoiceAction';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => 'booking-invoice-idempotency' }));

let tree: ReturnType<typeof TestRenderer.create>;
const onOpenInvoice = jest.fn();

function textOf(instance: any): string {
  return instance.children.map((child: any) => typeof child === 'string' ? child : textOf(child)).join('');
}

beforeEach(() => jest.clearAllMocks());
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

it('issues only after owner confirmation, uses the selected salon and an idempotency key', async () => {
  (apiFetch as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'invoice-new' } as InvoiceDetailDto);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    await act(async () => {
      tree = TestRenderer.create(createElement(CompletedBookingInvoiceAction, { salonId: 'salon-1', bookingId: 'booking-1', language: 'EN', onOpenInvoice }));
    });
    const button = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Issue invoice')[0];
    await act(async () => button.props.onPress());
    expect(apiFetch).toHaveBeenNthCalledWith(1, 'dashboard/salons/salon-1/invoices/by-source?bookingId=booking-1');
    expect(alert).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('does not record or collect a payment'), expect.any(Array));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const confirm = alert.mock.calls[0]?.[2]?.[1] as { onPress: () => void };
    await act(async () => confirm.onPress());
    expect(apiFetch).toHaveBeenLastCalledWith('dashboard/salons/salon-1/invoices', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'booking-invoice-idempotency' },
      body: JSON.stringify({ bookingId: 'booking-1' }),
    });
    expect(onOpenInvoice).toHaveBeenCalledWith('invoice-new');
  } finally {
    alert.mockRestore();
  }
});

it('opens the existing invoice instead of issuing a duplicate', async () => {
  (apiFetch as jest.Mock).mockResolvedValueOnce({ id: 'invoice-existing' } as InvoiceDetailDto);
  await act(async () => {
    tree = TestRenderer.create(createElement(CompletedBookingInvoiceAction, { salonId: 'salon-1', bookingId: 'booking-1', language: 'EN', onOpenInvoice }));
  });
  const button = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Issue invoice')[0];
  await act(async () => button.props.onPress());
  expect(onOpenInvoice).toHaveBeenCalledWith('invoice-existing');
  expect(apiFetch).toHaveBeenCalledTimes(1);
});
