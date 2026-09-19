import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { ArrivalAlertOverlay } from '../ArrivalAlertOverlay';
import { apiFetch } from '../../../lib/api';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../../../lib/realtime';
import { useAuth } from '../../../lib/auth-context';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/realtime', () => ({
  getRealtimeSocket: jest.fn(),
  joinSalonRoom: jest.fn(),
  onReconnect: jest.fn(),
}));
jest.mock('../../../lib/auth-context', () => ({ useAuth: jest.fn() }));

let tree;
const fakeSocket = { on: jest.fn(), off: jest.fn() };

function textOf(instance) {
  if (typeof instance === 'string') return instance;
  return instance.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}
function findByText(type, text) {
  return tree.root.findAllByType(type).find((i) => textOf(i) === text);
}
function findByTextIncludes(type, text) {
  return tree.root.findAllByType(type).find((i) => textOf(i).includes(text));
}

const NOT_DUE = {
  bookingId: 'b1',
  salonId: 's1',
  slotStart: new Date(Date.now() + 30 * 60_000).toISOString(),
  serviceName: 'Haircut',
  customerDisplayName: 'Your Haircut customer',
  graceExpired: false,
  noShowChargePreview: null,
  currency: 'INR',
};

async function renderOverlay(alerts) {
  apiFetch.mockResolvedValue(alerts);
  let renderedTree;
  await act(async () => {
    renderedTree = TestRenderer.create(<ArrivalAlertOverlay salonId="s1" />);
  });
  await act(async () => {}); // flush the initial Promise.resolve().then(refresh)
  tree = renderedTree;
  return renderedTree;
}

// This project's component tests run under Jest's 'node' environment (see jest.config.cjs) —
// there is no real `window`/speechSynthesis here. The component itself already guards every
// window access behind `typeof window === "undefined"`, so it silently no-ops for voice/the
// cross-tab lock in this test environment; these tests exercise the dialog/confirmation/API-call
// logic, which is environment-independent.
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  getRealtimeSocket.mockReturnValue(fakeSocket);
  onReconnect.mockReturnValue(() => {});
  useAuth.mockReturnValue({ user: { preferredLanguage: 'EN' } });
});

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = undefined;
  jest.useRealTimers();
});

it('renders nothing when there are no eligible alerts', async () => {
  await renderOverlay([]);
  expect(tree.toJSON()).toBeNull();
});

it('never invents a customer name, and shows the truthful fallback plus service/time', async () => {
  await renderOverlay([NOT_DUE]);
  expect(findByTextIncludes('p', 'Your Haircut customer')).toBeDefined();
  expect(findByText('p', 'Appointment arrival check')).toBeDefined();
});

it('joins the salon realtime room and subscribes to resolving events', async () => {
  await renderOverlay([NOT_DUE]);
  expect(joinSalonRoom).toHaveBeenCalledWith('s1');
  expect(fakeSocket.on).toHaveBeenCalledWith('booking.arrival_alert', expect.any(Function));
  expect(fakeSocket.on).toHaveBeenCalledWith('queue.updated', expect.any(Function));
});

it('ARRIVED requires a second confirmation before calling the backend', async () => {
  await renderOverlay([NOT_DUE]);
  await act(async () => findByText('button', 'Arrived').props.onClick());
  expect(findByText('h2', 'Confirm customer arrival?')).toBeDefined();
  expect(apiFetch).not.toHaveBeenCalledWith(
    expect.stringContaining('/arrive'),
    expect.anything(),
  );

  apiFetch.mockResolvedValueOnce({});
  apiFetch.mockResolvedValueOnce([]); // the refresh() after success finds nothing left due
  await act(async () => findByText('button', 'Confirm Arrived').props.onClick());
  expect(apiFetch).toHaveBeenCalledWith(
    expect.stringContaining('bookings/b1/arrive'),
    expect.objectContaining({ method: 'POST' }),
  );
});

it('Go Back on the ARRIVED confirmation returns to the main prompt without calling the backend', async () => {
  await renderOverlay([NOT_DUE]);
  await act(async () => findByText('button', 'Arrived').props.onClick());
  await act(async () => findByText('button', 'Go Back').props.onClick());
  expect(findByText('p', 'Has Your Haircut customer arrived?')).toBeDefined();
  expect(apiFetch).toHaveBeenCalledTimes(1); // only the initial list load, never /arrive
});

it('NOT ARRIVED before grace expiry offers "not here yet" and never charges or calls no-show', async () => {
  await renderOverlay([NOT_DUE]);
  await act(async () => findByText('button', 'Not arrived').props.onClick());
  expect(findByText('h2', 'Customer not here yet?')).toBeDefined();
  expect(findByTextIncludes('p', 'will NOT be marked as a no-show yet')).toBeDefined();

  await act(async () => findByText('button', 'Confirm Not Arrived Yet').props.onClick());
  expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining('/no-show'), expect.anything());
});

it('NOT ARRIVED after grace expiry escalates to a backend-authoritative Mark No Show confirmation', async () => {
  const dueAlert = { ...NOT_DUE, graceExpired: true, noShowChargePreview: 150 };
  await renderOverlay([dueAlert]);
  await act(async () => findByText('button', 'Not arrived').props.onClick());
  expect(findByText('h2', 'Mark customer as No Show?')).toBeDefined();
  expect(findByTextIncludes('p', 'INR150 no-show charge')).toBeDefined();

  apiFetch.mockResolvedValueOnce({});
  apiFetch.mockResolvedValueOnce([]);
  await act(async () => findByText('button', 'Confirm No Show').props.onClick());
  expect(apiFetch).toHaveBeenCalledWith(
    expect.stringContaining('bookings/b1/no-show'),
    expect.objectContaining({ method: 'POST' }),
  );
});

it('never shows a fabricated/guessed charge before the grace period has elapsed', async () => {
  await renderOverlay([NOT_DUE]); // graceExpired: false, noShowChargePreview: null
  await act(async () => findByText('button', 'Not arrived').props.onClick());
  expect(findByText('h2', 'Customer not here yet?')).toBeDefined();
  expect(findByTextIncludes('h2', 'No Show')).toBeUndefined();
});

it('Snooze removes the alert from view without any backend call', async () => {
  await renderOverlay([NOT_DUE]);
  await act(async () => findByText('button', 'Snooze 2 minutes').props.onClick());
  expect(tree.toJSON()).toBeNull();
  expect(apiFetch).toHaveBeenCalledTimes(1); // only the initial load — snooze is client-only
});
