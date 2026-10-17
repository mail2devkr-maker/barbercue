import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { BookingFlow } from '../BookingFlow';
import { apiFetch } from '../../../lib/api';
import { rememberCampaign, recallCampaign, CAMPAIGN_TTL_MS } from '../../../lib/campaign-token';

// A remembered campaign code (from a shared link) is sent as the optional `attributionToken` on the final POST /bookings
// for the SAME shop only, and never changes whether the booking is made. The server alone validates it.

const TOKEN = 'oLeUkicJNsEw6HKmYc_xP3uXRdJ-oxESwdPlmlErmuM';
const KEY = 'in/patna/fade-house';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ status: 'authenticated', user: { audience: 'CUSTOMER' }, googleLogin: jest.fn() }),
}));
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => '12345678-1234-4567-8910-123456789012' }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children }) => <a>{children}</a> }));
jest.mock('../../ui/Button', () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }));
jest.mock('../../auth/GoogleIdentityButton', () => ({ GoogleIdentityButton: () => null }));
jest.mock('../StaffStep', () => ({ StaffStep: ({ onSelect }) => <button onClick={() => onSelect(null)}>Any staff</button> }));
jest.mock('../DateStep', () => ({ DateStep: ({ onSelect }) => <button onClick={() => onSelect('2026-10-10')}>Select date</button> }));
jest.mock('../SlotStep', () => ({
  SlotStep: ({ slots, onSelect }) => (slots.length > 0 ? <button onClick={() => onSelect(slots[0])}>Select slot</button> : <span>No slots</span>),
}));
jest.mock('../CancelBookingDialog', () => ({ CancelBookingDialog: () => null }));
jest.mock('../RescheduleBookingDialog', () => ({ RescheduleBookingDialog: () => null }));
jest.mock('../BookingActionsBar', () => ({ BookingActionsBar: () => null }));
jest.mock('../../queue/CheckInPanel', () => ({ canCheckIn: () => false, CheckInPanel: () => null }));

const services = [{ id: 'haircut', name: 'Haircut', durationMinutes: 30, price: 300 }];

function fakeStore() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
}

let tree;
let store;
function textOf(instance) {
  return instance.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
}
const button = (text) => tree.root.findAllByType('button').find((b) => textOf(b) === text);
const serviceButton = (name) => tree.root.findAllByType('button').find((b) => textOf(b).includes(name));

async function renderFlow(props = {}) {
  await act(async () => {
    tree = TestRenderer.create(
      <BookingFlow salonId="s1" services={services} operatingHours={[]} currency="INR" countryCode="IN" salonTimezone="Asia/Kolkata" {...props} />,
    );
  });
}

async function confirm() {
  await act(async () => serviceButton('Haircut').props.onClick());
  await act(async () => button('Any staff').props.onClick());
  await act(async () => button('Select date').props.onClick());
  await act(async () => button('Select slot').props.onClick());
  await act(async () => button('Confirm booking').props.onClick());
  return apiFetch.mock.calls.find(([, opts]) => opts?.method === 'POST');
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  store = fakeStore();
  globalThis.window = { sessionStorage: store };
  apiFetch.mockImplementation(async (path, opts) => {
    if (opts?.method === 'POST') {
      return {
        id: 'b1', status: 'CONFIRMED', serviceName: 'Haircut', services: [{ serviceId: 'haircut', name: 'Haircut', durationMinutes: 30, price: 300 }],
        salonName: 'Test Salon', slotStart: '2026-10-10T09:00:00.000Z', slotEnd: '2026-10-10T09:30:00.000Z', salonTimezone: 'Asia/Kolkata',
        payableAmount: 300, creditsRedeemedAmount: null, prepaymentRequiredAmount: null, checkInOpensAt: null, checkInDueBy: null, selectedStyleName: null,
      };
    }
    if (path.includes('/staff')) return [];
    if (path.includes('/availability')) return [{ slotStart: '2026-10-10T09:00:00.000Z', slotEnd: '2026-10-10T09:30:00.000Z', available: true, state: 'AVAILABLE' }];
    if (path.includes('payment-info')) return { onlinePaymentAvailable: false };
    if (path.includes('balance')) return { balance: 0 };
    return [];
  });
});

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  delete globalThis.window;
});

it('sends the remembered code as attributionToken, and nothing else about its source', async () => {
  rememberCampaign(store, KEY, TOKEN);
  await renderFlow({ campaignKey: KEY });
  const post = await confirm();
  const body = JSON.parse(post[1].body);
  expect(body.attributionToken).toBe(TOKEN);
  expect(body).not.toHaveProperty('source');
  expect(body.serviceIds).toEqual(['haircut']);
});

it('forgets the code after the booking is confirmed, so a later booking is not attributed to the same link', async () => {
  rememberCampaign(store, KEY, TOKEN);
  await renderFlow({ campaignKey: KEY });
  await confirm();
  expect(recallCampaign(store, KEY)).toBeNull();
});

it('sends no attributionToken when there is no code for this flow', async () => {
  await renderFlow({ campaignKey: KEY });
  const body = JSON.parse((await confirm())[1].body);
  expect(body).not.toHaveProperty('attributionToken');
});

it('does not send another shop\'s code', async () => {
  rememberCampaign(store, 'in/patna/other-shop', TOKEN);
  await renderFlow({ campaignKey: KEY });
  const body = JSON.parse((await confirm())[1].body);
  expect(body).not.toHaveProperty('attributionToken');
});

it('does not send an expired code', async () => {
  rememberCampaign(store, KEY, TOKEN, Date.now() - CAMPAIGN_TTL_MS - 1000);
  await renderFlow({ campaignKey: KEY });
  const body = JSON.parse((await confirm())[1].body);
  expect(body).not.toHaveProperty('attributionToken');
});

it('does not read any code when the flow has no campaign key', async () => {
  rememberCampaign(store, KEY, TOKEN);
  await renderFlow();
  const body = JSON.parse((await confirm())[1].body);
  expect(body).not.toHaveProperty('attributionToken');
});

it('still books normally when session storage is blocked', async () => {
  globalThis.window = { get sessionStorage() { throw new Error('blocked'); } };
  await renderFlow({ campaignKey: KEY });
  const post = await confirm();
  expect(post).toBeDefined();
  expect(JSON.parse(post[1].body)).not.toHaveProperty('attributionToken');
});

it('keeps the code when the booking request fails, so the customer can try again', async () => {
  rememberCampaign(store, KEY, TOKEN);
  apiFetch.mockImplementation(async (path, opts) => {
    if (opts?.method === 'POST') throw new Error('network');
    if (path.includes('/availability')) return [{ slotStart: '2026-10-10T09:00:00.000Z', slotEnd: '2026-10-10T09:30:00.000Z', available: true, state: 'AVAILABLE' }];
    if (path.includes('payment-info')) return { onlinePaymentAvailable: false };
    if (path.includes('balance')) return { balance: 0 };
    return [];
  });
  await renderFlow({ campaignKey: KEY });
  await confirm();
  expect(recallCampaign(store, KEY)).toBe(TOKEN);
});
