// Booking with an offer chosen on the public Offers page (Codex PR #260/#268 contract): the flow reads the offer with GET offers/:id, sends
// offerId only for this shop's offer, shows the server's refusal in plain words and can continue without the offer. A server without the
// lookup by id (older than #268) falls back to a bounded search of the link's city list.
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { BookingFlow } from '../BookingFlow';
import { apiFetch, ApiError } from '../../../lib/api';

jest.mock('../../../lib/api', () => {
  class MockApiError extends Error {
    constructor(message, code = 'UNKNOWN_ERROR', status = 409) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});
jest.mock('../../../lib/auth-context', () => {
  const { SessionAudience } = require('@barbercue/shared');
  return { useAuth: () => ({ status: 'authenticated', user: { audience: SessionAudience.CUSTOMER }, googleLogin: jest.fn() }) };
});
let keyCounter = 0;
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => `key-${++keyCounter}` }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children }) => <a>{children}</a> }));
jest.mock('../../ui/Button', () => ({ Button: ({ children, variant, ...props }) => <button data-variant={variant} {...props}>{children}</button> }));
jest.mock('../../auth/GoogleIdentityButton', () => ({ GoogleIdentityButton: () => null }));
jest.mock('../ServiceStep', () => ({ ServiceStep: () => null }));
jest.mock('../StaffStep', () => ({ StaffStep: () => null }));
jest.mock('../DateStep', () => ({ DateStep: ({ onSelect }) => <button onClick={() => onSelect('2026-10-10')}>Select date</button> }));
jest.mock('../SlotStep', () => ({ SlotStep: ({ onSelect }) => <button onClick={() => onSelect({ slotStart: '2026-10-10T10:00:00Z', slotEnd: '2026-10-10T10:30:00Z' })}>Select slot</button> }));
jest.mock('../CancelBookingDialog', () => ({ CancelBookingDialog: () => null }));
jest.mock('../RescheduleBookingDialog', () => ({ RescheduleBookingDialog: () => null }));
jest.mock('../BookingActionsBar', () => ({ BookingActionsBar: () => null }));
jest.mock('../../queue/CheckInPanel', () => ({ canCheckIn: () => false, CheckInPanel: () => null }));

const OFFER_ID = '11111111-1111-4111-8111-111111111111';
const offer = (extra = {}) => ({
  id: OFFER_ID, kind: 'OFFER', status: 'ACTIVE', title: 'Diwali 15% off', description: null, discountType: 'PERCENT', discountValue: 15, currency: 'INR',
  audience: 'ALL', inactiveDays: null, validFrom: '2026-10-01T00:00:00.000Z', validTo: '2026-12-01T00:00:00.000Z', maxRedemptions: null, perCustomerLimit: 1,
  serviceIds: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  salon: { id: 's', name: 'Studio', slug: 'studio', city: 'Jharsuguda', countryCode: 'IN', citySlug: 'jharsuguda' }, eligibility: { audience: 'ALL', accountRequired: true },
  prices: [{ serviceId: 'svc', serviceName: 'Haircut', basePrice: 500, discount: 75, finalPrice: 425, currency: 'INR' }], ...extra,
});
const booking = { id: 'b1', status: 'CONFIRMED', payableAmount: 425, servicePrice: 500, creditsRedeemedAmount: null, serviceName: 'Haircut',
  services: [{ serviceId: 'svc', name: 'Haircut', durationMinutes: 30, price: 500 }], salonName: 'Studio', slotStart: '2026-10-10T10:00:00Z', salonTimezone: 'Asia/Kolkata',
  offerId: OFFER_ID, offerTitle: 'Diwali 15% off', onlineBookingDiscountAmount: 75 };

let tree;
let offerById;
let offersReply;
let postHandler;
let calls;
const text = () => JSON.stringify(tree.toJSON());
const buttons = (label) => tree.root.findAllByType('button').filter((b) => b.children.join('') === label);
async function click(label) { await act(async () => buttons(label)[0].props.onClick()); }
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
async function renderFlow(props = {}) {
  await act(async () => {
    tree = TestRenderer.create(<BookingFlow salonId="s" services={[{ id: 'svc', name: 'Haircut', price: 500 }]} operatingHours={[]}
      initialServiceIds={['svc']} initialStaffId={null} currency="INR" countryCode="IN" salonTimezone="Asia/Kolkata" {...props} />);
  });
  await flush();
  await click('Select date');
  await click('Select slot');
}
const posts = () => calls.filter((c) => c.opts?.method === 'POST');
const lookups = () => calls.filter((c) => /^offers\//.test(c.path));
const listCalls = () => calls.filter((c) => c.path.startsWith('offers?'));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  calls = [];
  offerById = async () => offer();
  offersReply = { items: [offer()], nextCursor: null };
  postHandler = async () => ({ ...booking });
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    if (opts?.method === 'POST') return postHandler();
    if (/^offers\//.test(path)) return offerById(path);
    if (path.startsWith('offers?')) return offersReply;
    if (path.includes('payment-info')) return { onlinePaymentAvailable: false };
    if (path.includes('balance')) return { balance: 0 };
    if (path.includes('cancellation-policy')) return null;
    return [];
  });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

describe('BookingFlow with an offer', () => {
  it('reads the offer by id, without searching any list, and shows an estimate that the server confirms', async () => {
    await renderFlow({ offerId: OFFER_ID, offerCity: 'jharsuguda' });
    expect(lookups().map((c) => c.path)).toEqual([`offers/${OFFER_ID}`]);
    expect(listCalls()).toHaveLength(0);
    const t = text();
    expect(t).toContain('Diwali 15% off');
    expect(t).toContain('15% off');
    expect(t).toContain('confirmed by FastQue when you book');
    expect(t).not.toContain('FastQue booking offer applied');
  });

  it('needs no city on the link at all', async () => {
    await renderFlow({ offerId: OFFER_ID });
    expect(lookups()).toHaveLength(1);
    await click('Confirm booking');
    expect(JSON.parse(posts()[0].opts.body).offerId).toBe(OFFER_ID);
  });

  it('sends offerId on the booking and shows the offer that was applied', async () => {
    await renderFlow({ offerId: OFFER_ID, offerCity: 'jharsuguda' });
    await click('Confirm booking');
    expect(JSON.parse(posts()[0].opts.body).offerId).toBe(OFFER_ID);
    expect(text()).toContain('Offer applied: ');
    expect(text()).toContain('Diwali 15% off');
    expect(text()).toContain('You save');
  });

  it('ignores an offer that belongs to another shop, and shows nothing of it', async () => {
    offerById = async () => offer({ title: 'Secret other-shop deal', salon: { id: 'other', name: 'Other', slug: 'other', city: 'Jharsuguda', countryCode: 'IN', citySlug: 'jharsuguda' } });
    await renderFlow({ offerId: OFFER_ID, offerCity: 'jharsuguda' });
    expect(text()).toContain('not available for this shop any more');
    expect(text()).not.toContain('Secret other-shop deal');
    await click('Confirm booking');
    expect(JSON.parse(posts()[0].opts.body).offerId).toBeUndefined();
  });

  it('treats OFFER_NOT_FOUND as final: no offer, and no list search', async () => {
    offerById = async () => { throw new ApiError('gone', 'OFFER_NOT_FOUND', 404); };
    await renderFlow({ offerId: OFFER_ID, offerCity: 'jharsuguda' });
    expect(text()).toContain('not available for this shop any more');
    expect(listCalls()).toHaveLength(0);
    await click('Confirm booking');
    expect(JSON.parse(posts()[0].opts.body).offerId).toBeUndefined();
  });

  it('on a server without the lookup by id, falls back to a search of the link city', async () => {
    offerById = async () => { throw new ApiError('Cannot GET /api/v1/offers/x', 'NOT_FOUND', 404); };
    await renderFlow({ offerId: OFFER_ID, offerCity: 'jharsuguda' });
    expect(listCalls()).toHaveLength(1);
    expect(new URLSearchParams(listCalls()[0].path.split('?')[1]).get('city')).toBe('jharsuguda');
    expect(text()).toContain('Diwali 15% off');
    await click('Confirm booking');
    expect(JSON.parse(posts()[0].opts.body).offerId).toBe(OFFER_ID);
  });

  it('on a server without the lookup and a link without a city, applies no offer and does not guess', async () => {
    offerById = async () => { throw new ApiError('Cannot GET', 'NOT_FOUND', 404); };
    await renderFlow({ offerId: OFFER_ID });
    expect(listCalls()).toHaveLength(0);
    await click('Confirm booking');
    expect(JSON.parse(posts()[0].opts.body).offerId).toBeUndefined();
  });

  it('does not search a list after any other failure, and keeps the booking available', async () => {
    offerById = async () => { throw new ApiError('boom', 'INTERNAL', 500); };
    await renderFlow({ offerId: OFFER_ID, offerCity: 'jharsuguda' });
    expect(listCalls()).toHaveLength(0);
    await click('Confirm booking');
    expect(JSON.parse(posts()[0].opts.body).offerId).toBeUndefined();
  });

  it('keeps the booking available when the lookup cannot be reached at all', async () => {
    offerById = async () => { throw new Error('offline'); };
    await renderFlow({ offerId: OFFER_ID, offerCity: 'jharsuguda' });
    await click('Confirm booking');
    expect(JSON.parse(posts()[0].opts.body).offerId).toBeUndefined();
  });

  it('asks for no offer at all when the page was not opened from an offer', async () => {
    await renderFlow();
    expect(lookups()).toHaveLength(0);
    expect(listCalls()).toHaveLength(0);
    await click('Confirm booking');
    expect(JSON.parse(posts()[0].opts.body).offerId).toBeUndefined();
  });

  it('says in plain words when the server refuses the offer, and can book without it with a new Idempotency-Key', async () => {
    let attempt = 0;
    postHandler = async () => { attempt += 1; if (attempt === 1) throw new ApiError('raw', 'OFFER_EXPIRED'); return { ...booking, offerId: null, offerTitle: null }; };
    await renderFlow({ offerId: OFFER_ID, offerCity: 'jharsuguda' });
    await click('Confirm booking');
    expect(text()).toContain('This offer has ended.');
    await click('Book without this offer');
    await click('Confirm booking');
    const [first, second] = posts();
    expect(JSON.parse(first.opts.body).offerId).toBe(OFFER_ID);
    expect(JSON.parse(second.opts.body).offerId).toBeUndefined();
    expect(first.opts.headers['Idempotency-Key']).not.toBe(second.opts.headers['Idempotency-Key']);
  });
});
