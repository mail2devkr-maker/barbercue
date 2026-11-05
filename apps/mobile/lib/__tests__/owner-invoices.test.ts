import { ownerBillingProfileRequestPath, ownerInvoiceByBookingRequestPath, ownerInvoiceDetailRequestPath, ownerInvoiceIssueRequestPath, ownerInvoicePaymentsRequestPath, ownerInvoiceVoidRequestPath, ownerInvoicesRequestPath } from '../owner-invoices';

describe('owner invoice routes', () => {
  it('builds bounded cursor pages scoped to the selected salon', () => {
    expect(ownerInvoicesRequestPath('salon/one')).toBe('dashboard/salons/salon%2Fone/invoices?limit=20');
    expect(ownerInvoicesRequestPath('salon-1', 'opaque cursor/+')).toBe('dashboard/salons/salon-1/invoices?limit=20&cursor=opaque+cursor%2F%2B');
  });

  it('encodes the salon and invoice identifiers in the owner-only detail route', () => {
    expect(ownerInvoiceDetailRequestPath('salon/one', 'invoice/one')).toBe('dashboard/salons/salon%2Fone/invoices/invoice%2Fone');
  });

  it('uses the same salon-scoped invoice route for recorded payment events', () => {
    expect(ownerInvoicePaymentsRequestPath('salon/one', 'invoice/one')).toBe('dashboard/salons/salon%2Fone/invoices/invoice%2Fone/payments');
  });

  it('uses the same salon-scoped invoice route for voiding with a reason', () => {
    expect(ownerInvoiceVoidRequestPath('salon/one', 'invoice/one')).toBe('dashboard/salons/salon%2Fone/invoices/invoice%2Fone/void');
  });

  it('scopes billing profile reads and writes to the selected shop', () => {
    expect(ownerBillingProfileRequestPath('salon/one')).toBe('dashboard/salons/salon%2Fone/billing-profile');
  });

  it('uses the server source lookup and issue route for a completed booking', () => {
    expect(ownerInvoiceByBookingRequestPath('salon/one', 'booking/one')).toBe('dashboard/salons/salon%2Fone/invoices/by-source?bookingId=booking%2Fone');
    expect(ownerInvoiceIssueRequestPath('salon/one')).toBe('dashboard/salons/salon%2Fone/invoices');
  });
});
