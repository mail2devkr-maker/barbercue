/**
 * Opens one invoice in the owner's Business center (Shop tab → Business → Invoices), from anywhere
 * in the owner app — a completed booking, a completed Live Queue visit. The navigation container is
 * required lazily so shared components that call this stay importable in tests that mock navigation.
 */
export function openOwnerInvoice(invoiceId: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy import (see above)
  const { navigationRef } = require('../navigation/navigation-ref') as typeof import('../navigation/navigation-ref');
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('OwnerShopTab', { screen: 'OwnerBusiness', params: { initialPanel: 'invoices', openInvoiceId: invoiceId } });
}
