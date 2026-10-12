import { CANCELLATION_ACTOR_LABEL, describeCancellationNotice, formatChange, formatMoney, initialsOf, ownerOpsPaths } from '../ops';

describe('owner-ops routes', () => {
  it('every route is under the authoritative dashboard prefix (never an un-prefixed path)', () => {
    const salon = 'salon-1';
    const routes = [
      ownerOpsPaths.overview(salon),
      ownerOpsPaths.cancellationAnalytics(salon, '30d'),
      ownerOpsPaths.queue(salon),
      ownerOpsPaths.queueCustomers(salon),
      ownerOpsPaths.queueAutoAssign(salon),
      ownerOpsPaths.queueSettings(salon),
      ownerOpsPaths.entryAutoAssign('entry-1'),
      ownerOpsPaths.inShopBooking(salon),
      ownerOpsPaths.cancelBooking(salon, 'b-1'),
      ownerOpsPaths.rescheduleBooking(salon, 'b-1'),
      ownerOpsPaths.staffMeWork(salon),
      ownerOpsPaths.staffAccess(salon, 'st-1', 'revoke'),
      ownerOpsPaths.contactVisibility(salon),
      ownerOpsPaths.billingProfile(salon),
      ownerOpsPaths.invoices(salon),
      ownerOpsPaths.invoice(salon, 'inv-1'),
      ownerOpsPaths.invoicePayments(salon, 'inv-1'),
    ];
    for (const route of routes) expect(route.startsWith('dashboard/')).toBe(true);
  });

  it('matches the backend controller routes exactly', () => {
    expect(ownerOpsPaths.overview('s')).toBe('dashboard/salons/s/overview');
    expect(ownerOpsPaths.queueCustomers('s')).toBe('dashboard/salons/s/queue/customers');
    expect(ownerOpsPaths.queueAutoAssign('s')).toBe('dashboard/salons/s/queue/auto-assign');
    expect(ownerOpsPaths.entryAutoAssign('e')).toBe('dashboard/queue-entries/e/auto-assign');
    expect(ownerOpsPaths.inShopBooking('s')).toBe('dashboard/salons/s/bookings/in-shop');
    expect(ownerOpsPaths.cancelBooking('s', 'b')).toBe('dashboard/salons/s/bookings/b/cancel');
    expect(ownerOpsPaths.staffMeWork('s')).toBe('dashboard/salons/s/staff/me/work');
    expect(ownerOpsPaths.staffAccess('s', 'x', 'restore')).toBe('dashboard/salons/s/staff/x/access/restore');
    expect(ownerOpsPaths.invoicePayments('s', 'i')).toBe('dashboard/salons/s/invoices/i/payments');
    expect(ownerOpsPaths.myInvoices()).toBe('invoices/mine');
    expect(ownerOpsPaths.myInvoice('i')).toBe('invoices/mine/i');
  });

  it('builds filtered list queries only with the filters that are set', () => {
    expect(ownerOpsPaths.invoices('s')).toBe('dashboard/salons/s/invoices');
    expect(ownerOpsPaths.invoices('s', { payment: 'ALL' })).toBe('dashboard/salons/s/invoices');
    expect(ownerOpsPaths.invoices('s', { payment: 'UNPAID', q: 'amit', cursor: 'c1' })).toBe(
      'dashboard/salons/s/invoices?payment=UNPAID&q=amit&cursor=c1',
    );
    expect(ownerOpsPaths.cancellationAnalytics('s', '7d')).toBe('dashboard/salons/s/analytics/cancellations?range=7d');
    expect(ownerOpsPaths.cancellationAnalytics('s', '7d', 'OWNER')).toBe('dashboard/salons/s/analytics/cancellations?range=7d&actor=OWNER');
    expect(ownerOpsPaths.cancellationAnalytics('s', '7d', 'ALL')).toBe('dashboard/salons/s/analytics/cancellations?range=7d');
    expect(ownerOpsPaths.invoiceBySource('s', { bookingId: 'b' })).toBe('dashboard/salons/s/invoices/by-source?bookingId=b');
  });
});

describe('money and change formatting', () => {
  it('shows rupees with Indian grouping', () => {
    expect(formatMoney(0, 'INR')).toBe('₹0');
    expect(formatMoney(710, 'INR')).toBe('₹710');
    expect(formatMoney(25000, 'INR')).toBe('₹25,000');
    expect(formatMoney(1234567.5, 'INR')).toBe('₹12,34,567.50');
    expect(formatMoney(-340, 'INR')).toBe('-₹340');
  });
  it('uses an ISO code rather than a guessed symbol for other currencies', () => {
    expect(formatMoney(12.5, 'USD')).toBe('USD 12.50');
    expect(formatMoney(1234567, 'USD')).toBe('USD 1,234,567');
  });
  it('defaults to rupees when the shop has no currency yet', () => {
    expect(formatMoney(5, null)).toBe('₹5');
  });
  it('never invents a percentage when there is nothing to compare with', () => {
    expect(formatChange(null)).toEqual({ text: 'No earlier data', tone: 'flat' });
    expect(formatChange(0)).toEqual({ text: 'No change', tone: 'flat' });
    expect(formatChange(12.5)).toEqual({ text: '+12.5%', tone: 'up' });
    expect(formatChange(-3)).toEqual({ text: '-3%', tone: 'down' });
  });
});

describe('labels', () => {
  it('derives initials without exposing an e-mail address', () => {
    expect(initialsOf('owner.19dfc0@fastque-demo.test')).toBe('OW');
    expect(initialsOf('Arjun Mehta')).toBe('AM');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
  });
  it('labels legacy cancellations as not recorded rather than guessing', () => {
    expect(CANCELLATION_ACTOR_LABEL.UNKNOWN).toBe('Not recorded');
    expect(CANCELLATION_ACTOR_LABEL.STAFF).toBe('Barber');
  });
});

describe('cancellation notice wording tells only what is true', () => {
  it('claims both channels only when both were delivered', () => {
    expect(describeCancellationNotice({ notification: { inApp: 'SENT', push: 'SENT' } })).toMatch(/in the app and by push/);
  });
  it('says plainly when the customer has no account', () => {
    expect(describeCancellationNotice({ notification: { inApp: 'NO_ACCOUNT', push: 'NO_ACCOUNT' } })).toMatch(/without a FastQue account/);
  });
  it('does not claim delivery for a failed or pending push', () => {
    const text = describeCancellationNotice({ notification: { inApp: 'SENT', push: 'FAILED' } });
    expect(text).toMatch(/retried/);
    expect(text).not.toMatch(/by push notification\.$/);
  });
  it('never mentions SMS', () => {
    for (const push of ['SENT', 'FAILED', 'NO_DEVICE']) {
      expect(describeCancellationNotice({ notification: { inApp: 'SENT', push } })).not.toMatch(/sms|text message/i);
    }
  });
});
