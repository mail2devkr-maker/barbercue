/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { uiStringsFor } from '@barbercue/shared';
import { QueueStatusPanel } from '../QueueStatusPanel';

// The customer's ticket: a barber and chair reserved for them is "Your barber is ready" - never "In
// service" - and the service only reads as in service once the barber has started it.

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock('../../lib/api', () => ({ apiFetch: jest.fn().mockResolvedValue(null) }));
jest.mock('../../lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'c1', preferredLanguage: 'EN' } }) }));
jest.mock('../../lib/realtime', () => ({
  getRealtimeSocket: () => ({ on: jest.fn(), off: jest.fn() }),
  joinSalonRoom: jest.fn(),
  onReconnect: () => () => undefined,
}));
const mockLanguage: { current: { language: string; t: Record<string, string> } } = { current: { language: 'EN', t: {} } };
jest.mock('../../lib/language-context', () => ({ useLanguage: () => mockLanguage.current }));

const entry = (over: Record<string, unknown> = {}) =>
  ({
    id: 'q1',
    salonId: 's1',
    bookingId: null,
    source: 'WALK_IN',
    tokenNumber: 9,
    status: 'WAITING',
    assignedStaffId: null,
    assignedChairId: null,
    estimatedWaitMinutes: 10,
    serviceId: null,
    serviceName: null,
    position: 2,
    customerPhone: null,
    customerName: null,
    arrivedAt: null,
    assignedStaffName: null,
    assignedChairLabel: null,
    preferredStaffId: null,
    preferredStaffName: null,
    activeServiceSessionId: null,
    joinedAt: '2026-10-13T10:00:00.000Z',
    calledAt: null,
    estimatedWaitRangeMinutes: null,
    turnApproaching: false,
    ...over,
  }) as never;

let tree: ReturnType<typeof TestRenderer.create> | undefined;
const text = () => JSON.stringify(tree!.toJSON());
async function mount(e: ReturnType<typeof entry>) {
  await act(async () => {
    tree = TestRenderer.create(createElement(QueueStatusPanel, { entry: e, onEntryChange: jest.fn() }));
  });
  await act(async () => {});
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mockLanguage.current = { language: 'EN', t: uiStringsFor('EN') as unknown as Record<string, string> };
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
});

describe('customer queue ticket', () => {
  it('shows an assigned customer that their barber is ready, with barber and chair - not "in service"', async () => {
    await mount(entry({ status: 'CALLED', assignedStaffId: 'st1', assignedStaffName: 'Ravi', assignedChairLabel: 'Chair 2' }));
    const screen = text();
    expect(screen).toContain('Your barber is ready');
    expect(screen).toContain('Ravi will serve you at Chair 2.');
    expect(screen).not.toContain('In service');
    expect(screen).not.toContain("You're being called");
  });

  it('copes with an assigned customer whose chair label is not known', async () => {
    await mount(entry({ status: 'CALLED', assignedStaffId: 'st1', assignedStaffName: 'Ravi' }));
    expect(text()).toContain('Ravi will serve you.');
  });

  it('a customer who was only called to the counter still sees the called message', async () => {
    await mount(entry({ status: 'CALLED' }));
    expect(text()).toContain(uiStringsFor('EN').calledMessage);
    expect(text()).not.toContain('Your barber is ready');
  });

  it('once the barber starts, the ticket reads as in service with their barber and chair', async () => {
    await mount(entry({ status: 'IN_SERVICE', assignedStaffId: 'st1', assignedStaffName: 'Ravi', assignedChairLabel: 'Chair 2' }));
    expect(text()).toContain('In service');
    expect(text()).not.toContain('Your barber is ready');
  });

  it('is shown in Hindi when the customer language is Hindi', async () => {
    const hi = uiStringsFor('HI');
    mockLanguage.current = { language: 'HI', t: hi as unknown as Record<string, string> };
    await mount(entry({ status: 'CALLED', assignedStaffId: 'st1', assignedStaffName: 'Ravi', assignedChairLabel: 'Chair 2' }));
    expect(text()).toContain(hi.customerAssignedMessage);
    expect(text()).toContain('Ravi');
    expect(text()).not.toContain('Your barber is ready');
  });
});
