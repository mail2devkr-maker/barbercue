import { DASHBOARD_PATHS, OWNER_OPS_PATHS } from '@barbercue/shared';

export function ownerInvoicesRequestPath(salonId: string, cursor?: string): string {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${OWNER_OPS_PATHS.invoices}?${query.toString()}`;
}

export function ownerInvoiceDetailRequestPath(salonId: string, invoiceId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${OWNER_OPS_PATHS.invoices}/${encodeURIComponent(invoiceId)}`;
}

export function ownerInvoicePaymentsRequestPath(salonId: string, invoiceId: string): string {
  return `${ownerInvoiceDetailRequestPath(salonId, invoiceId)}/payments`;
}
