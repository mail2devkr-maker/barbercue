import { DASHBOARD_PATHS, OWNER_OPS_PATHS } from '@barbercue/shared';

export function ownerInvoicesRequestPath(salonId: string, cursor?: string): string {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${OWNER_OPS_PATHS.invoices}?${query.toString()}`;
}

export function ownerInvoiceDetailRequestPath(salonId: string, invoiceId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${OWNER_OPS_PATHS.invoices}/${encodeURIComponent(invoiceId)}`;
}

export function ownerInvoicePdfRequestPath(salonId: string, invoiceId: string): string {
  return `${ownerInvoiceDetailRequestPath(salonId, invoiceId)}/pdf`;
}

export function ownerInvoicePaymentsRequestPath(salonId: string, invoiceId: string): string {
  return `${ownerInvoiceDetailRequestPath(salonId, invoiceId)}/payments`;
}

export function ownerInvoiceVoidRequestPath(salonId: string, invoiceId: string): string {
  return `${ownerInvoiceDetailRequestPath(salonId, invoiceId)}/void`;
}

export function ownerBillingProfileRequestPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/billing-profile`;
}

export function ownerInvoiceByBookingRequestPath(salonId: string, bookingId: string): string {
  const query = new URLSearchParams({ bookingId });
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${OWNER_OPS_PATHS.invoices}/by-source?${query.toString()}`;
}

export function ownerInvoiceIssueRequestPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${OWNER_OPS_PATHS.invoices}`;
}
