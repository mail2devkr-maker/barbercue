import type { InvoiceDetailDto, InvoiceSummaryDto } from '@barbercue/shared';
import { formatMoney } from './ops';

export type InvoiceTone = 'ok' | 'warn' | 'info' | 'neutral' | 'danger';

export const PAYMENT_FILTERS: readonly { id: string; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'UNPAID', label: 'Unpaid' },
  { id: 'PARTIALLY_PAID', label: 'Partly paid' },
  { id: 'PAID', label: 'Paid' },
  { id: 'REFUNDED', label: 'Refunded' },
  { id: 'VOID', label: 'Void' },
];

/** What an invoice's payment state means in plain words. "Paid" only ever follows a recorded payment. */
export function paymentStatusView(invoice: Pick<InvoiceSummaryDto, 'status' | 'paymentStatus'>): { label: string; tone: InvoiceTone } {
  if (invoice.status === 'VOID') return { label: 'Void', tone: 'danger' };
  switch (invoice.paymentStatus) {
    case 'PAID':
      return { label: 'Paid', tone: 'ok' };
    case 'PARTIALLY_PAID':
      return { label: 'Partly paid', tone: 'info' };
    case 'REFUNDED':
      return { label: 'Refunded', tone: 'neutral' };
    default:
      return { label: 'Unpaid', tone: 'warn' };
  }
}

export const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', OTHER: 'Other' };
export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'OTHER'] as const;

/** A plain-text summary the owner can share from the phone (no PDF file handling required). */
export function invoiceShareText(invoice: InvoiceDetailDto): string {
  const money = (n: number) => formatMoney(n, invoice.currency);
  const lines = invoice.lines.map((l) => `${l.description} x${l.quantity}  ${money(l.lineTotal)}`);
  return [
    `${invoice.seller.legalName} - Invoice ${invoice.number}`,
    `Date: ${invoice.serviceDate}`,
    invoice.customerName ? `Customer: ${invoice.customerName}` : null,
    ...lines,
    invoice.taxLabel && invoice.taxTotal > 0 ? `${invoice.taxLabel}: ${money(invoice.taxTotal)}` : null,
    `Total: ${money(invoice.total)}`,
    `Received: ${money(invoice.amountPaid)}`,
    invoice.balanceDue > 0 ? `Balance due: ${money(invoice.balanceDue)}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/** Parses a typed rupee amount; null for anything that is not a positive amount with <= 2 decimals. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value > 0 ? value : null;
}
