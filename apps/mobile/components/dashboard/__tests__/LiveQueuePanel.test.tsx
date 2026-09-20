/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Alert, Linking } from 'react-native';
import { uiStringsFor } from '@barbercue/shared';
import { LiveQueuePanel } from '../LiveQueuePanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, body: { error: { code: string; message: string } }) {
      super(body.error.message);
      this.status = status;
      this.code = body.error.code;
    }
  },
}));
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => 'idem-key' }));
jest.mock('../../../lib/language-context', () => ({
  useLanguage: () => ({ language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') }),
}));
jest.mock('../../../lib/realtime', () => ({
  getRealtimeSocket: () => ({ on: jest.fn(), off: jest.fn() }),
  joinSalonRoom: jest.fn(),
  onReconnect: () => () => undefined,
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, []),
}));
jest.mock('../../ui', () => {
  const { View, Text } = require('react-native');
  const { createElement: h } = require('react');
  return {
    Card: View,
    Skeleton: View,
    EmptyState: () => null,
    Button: require('../../ui/Button').Button,
    InlineError: ({ message }: { message: string }) => h(Text, { testID: 'inline-error' }, message),
  };
});

const t = uiStringsFor('EN');

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    salonId: 's1',
    bookingId: null,
    source: 'WALK_IN',
    tokenNumber: 7,
    status: 'WAITING',
    assignedStaffId: null,
    assignedChairId: null,
    estimatedWaitMinutes: 5,
    serviceId: 'sv1',
    serviceName: 'Beard',
    position: 1,
    customerPhone: '+919811122233',
    customerName: 'Ravi Kumar',
    arrivedAt: null,
    assignedStaffName: null,
    assignedChairLabel: null,
    activeServiceSessionId: null,
    joinedAt: '2026-09-20T10:00:00.000Z',
    calledAt: null,
    estimatedWaitRangeMinutes: null,
    turnApproaching: false,
    ...overrides,
  };
}

function dashboard(entries: unknown[]) {
  return {
    entries,
    staffRoster: [{ id: 'st1', displayName: 'Sam', status: 'ACTIVE' }],
    chairs: [{ id: 'ch1', label: 'Chair 1', occupancy: 'FREE' }],
    services: [],
  };
}

let tree: ReturnType<typeof TestRenderer.create> | undefined;
let queue: unknown[];
let alertSpy: jest.SpyInstance;
const postCalls = () =>
  (apiFetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'POST').map(([path, init]) => ({ path, init }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TestNode = { props: Record<string, any>; children?: unknown[]; findAll: (predicate: (node: TestNode) => boolean) => TestNode[] };
const allNodes = (predicate: (node: TestNode) => boolean): TestNode[] =>
  (tree!.root as unknown as TestNode).findAll(predicate);
const isButtonTitled = (n: TestNode, title: string) => n.props?.title === title && typeof n.props?.onPress === 'function';
const buttonWithTitle = (title: string): TestNode => allNodes((n) => isButtonTitled(n, title))[0];
const hasButton = (title: string) => allNodes((n) => isButtonTitled(n, title)).length > 0;
const screenText = () => JSON.stringify(tree!.toJSON());
const press = async (title: string) => {
  const b = buttonWithTitle(title);
  if (!b) throw new Error(`no button "${title}"`);
  await act(async () => {
    await b.props.onPress();
  });
};
async function confirmAlert() {
  const buttons = alertSpy.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  const destructive = buttons.find((b) => b.onPress)!;
  await act(async () => {
    destructive.onPress!();
  });
}

async function render() {
  await act(async () => {
    tree = TestRenderer.create(createElement(LiveQueuePanel, { salonId: 's1' }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  queue = [entry()];
  (apiFetch as jest.Mock).mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return {};
    if (path.endsWith('/queue')) return dashboard(queue);
    return {};
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

describe('customer identity + contact', () => {
  it('shows token, customer name, mobile number, service and arrival state on the card', async () => {
    await render();
    const text = screenText();
    expect(text).toContain('#');
    expect(text).toContain('Ravi Kumar');
    expect(text).toContain('+919811122233');
    expect(text).toContain('Beard');
    expect(text).toContain(t.notYetArrivedStatus);
  });

  it('says so truthfully when no name or phone was provided - never inventing one', async () => {
    queue = [entry({ customerName: null, customerPhone: null })];
    await render();
    expect(screenText()).toContain(t.customerNameMissing);
    expect(screenText()).toContain(t.customerPhoneMissing);
    expect(hasButton(t.phoneCustomerAction)).toBe(false); // nothing to dial
  });

  it('offers a separate explicit "Phone customer" action that opens the device dialler with a tel: link', async () => {
    await render();
    expect(t.phoneCustomerAction).not.toBe(t.callAction); // the two meanings are never confused
    await press(t.phoneCustomerAction);
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+919811122233');
    expect(postCalls()).toHaveLength(0); // phoning never mutates queue state
  });

  it('never shows a phone action for a malformed number', async () => {
    queue = [entry({ customerPhone: '123' })];
    await render();
    expect(hasButton(t.phoneCustomerAction)).toBe(false);
  });
});

describe('operator actions use the authoritative /dashboard routes', () => {
  it('Call (queue state) POSTs dashboard/queue-entries/:id/call', async () => {
    await render();
    await press(t.callAction);
    expect(postCalls().map((c) => c.path)).toEqual(['dashboard/queue-entries/q1/call']);
  });

  it('Cancel asks first, then POSTs dashboard/queue-entries/:id/cancel', async () => {
    await render();
    await press(t.cancelAction);
    expect(alertSpy).toHaveBeenCalledWith(t.confirmCancelEntryTitle, t.confirmCancelEntryBody, expect.any(Array));
    expect(postCalls()).toHaveLength(0); // nothing sent until confirmed
    await confirmAlert();
    expect(postCalls().map((c) => c.path)).toEqual(['dashboard/queue-entries/q1/cancel']);
  });

  it('declining the Cancel confirmation sends nothing', async () => {
    await render();
    await press(t.cancelAction);
    const buttons = alertSpy.mock.calls.at(-1)![2] as { text: string; style?: string }[];
    expect(buttons.some((b) => b.style === 'cancel' && b.text === t.keepEntryAction)).toBe(true);
    expect(postCalls()).toHaveLength(0);
  });

  it('Mark arrived POSTs dashboard/queue-entries/:id/arrive', async () => {
    await render();
    await press(t.markArrivedAction);
    expect(postCalls().map((c) => c.path)).toEqual(['dashboard/queue-entries/q1/arrive']);
  });

  it('No-show asks first, then POSTs dashboard/queue-entries/:id/no-show', async () => {
    queue = [entry({ status: 'CALLED', arrivedAt: '2026-09-20T10:05:00.000Z' })];
    await render();
    await press(t.noShowAction);
    expect(alertSpy).toHaveBeenCalledWith(t.confirmNoShowEntryTitle, t.confirmNoShowEntryBody, expect.any(Array));
    await confirmAlert();
    expect(postCalls().map((c) => c.path)).toEqual(['dashboard/queue-entries/q1/no-show']);
  });

  it('Assign POSTs dashboard/queue-entries/:id/assign with staff, chair and service', async () => {
    queue = [entry({ status: 'CALLED', arrivedAt: '2026-09-20T10:05:00.000Z' })];
    await render();
    await press(t.assignAction);
    const chip = (label: string) =>
      allNodes((n) => typeof n.props?.onPress === 'function' && n.findAll((c) => Boolean(c.children?.includes(label))).length > 0)[0];
    await act(async () => chip('Sam').props.onPress());
    await act(async () => chip('Chair 1').props.onPress());
    await press(t.confirmAssignmentAction);
    const [call] = postCalls();
    expect(call.path).toBe('dashboard/queue-entries/q1/assign');
    expect(JSON.parse(call.init.body)).toEqual({ staffId: 'st1', chairId: 'ch1', serviceId: 'sv1' });
    expect(call.init.headers['Idempotency-Key']).toBe('idem-key');
  });

  it('Complete Service asks first, then POSTs dashboard/service-sessions/:sessionId/complete (the ServiceSession route, not a queue-entry write)', async () => {
    queue = [
      entry({ status: 'IN_SERVICE', arrivedAt: '2026-09-20T10:05:00.000Z', activeServiceSessionId: 'sess1', assignedStaffName: 'Sam', assignedChairLabel: 'Chair 1' }),
    ];
    await render();
    await press(t.completeAction);
    expect(alertSpy).toHaveBeenCalledWith(t.confirmCompleteServiceTitle, t.confirmCompleteServiceBody, expect.any(Array));
    expect(postCalls()).toHaveLength(0);
    await confirmAlert();
    expect(postCalls().map((c) => c.path)).toEqual(['dashboard/service-sessions/sess1/complete']);
  });

  it('no operator request is ever sent to an un-prefixed route', async () => {
    await render();
    await press(t.markArrivedAction);
    await press(t.callAction);
    await press(t.cancelAction);
    await confirmAlert();
    for (const { path } of postCalls()) expect(path.startsWith('dashboard/')).toBe(true);
  });
});

describe('arrival state and lifecycle', () => {
  it('a remote join starts NOT arrived: Mark arrived is offered, and the badge says so', async () => {
    await render();
    expect(hasButton(t.markArrivedAction)).toBe(true);
    expect(screenText()).toContain(t.notYetArrivedStatus);
  });

  it('once arrived, the badge changes and Mark arrived disappears (idempotent UI)', async () => {
    queue = [entry({ arrivedAt: '2026-09-20T10:05:00.000Z' })];
    await render();
    expect(hasButton(t.markArrivedAction)).toBe(false);
    expect(screenText()).toContain(t.arrivedStatus);
  });

  it('an appointment check-in is shown as arrived from the start', async () => {
    queue = [entry({ source: 'APPOINTMENT', bookingId: 'b1', arrivedAt: '2026-09-20T10:00:00.000Z' })];
    await render();
    expect(screenText()).toContain(t.arrivedStatus);
    expect(hasButton(t.markArrivedAction)).toBe(false);
  });

  it('Assign is only offered for a called customer who has arrived', async () => {
    queue = [entry({ status: 'CALLED', arrivedAt: null })];
    await render();
    expect(hasButton(t.assignAction)).toBe(false);
    expect(hasButton(t.markArrivedAction)).toBe(true);
  });

  it('Cancel is not offered mid-service, where an accidental tap would abort a running session', async () => {
    queue = [entry({ status: 'IN_SERVICE', arrivedAt: '2026-09-20T10:05:00.000Z', activeServiceSessionId: 'sess1' })];
    await render();
    expect(hasButton(t.cancelAction)).toBe(false);
    expect(hasButton(t.completeAction)).toBe(true);
  });
});

describe('failures are translated, never raw', () => {
  it('shows friendly copy instead of "Cannot POST /api/v1/..." and keeps a safe diagnostic log', async () => {
    (apiFetch as jest.Mock).mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === 'POST') {
        const { ApiError } = require('../../../lib/api');
        throw new ApiError(404, { error: { code: 'UNKNOWN_ERROR', message: 'Cannot POST /api/v1/queue-entries/q1/call' } });
      }
      return dashboard(queue);
    });
    await render();
    await press(t.callAction);
    const text = screenText();
    expect(text).toContain(t.couldNotCompleteAction);
    expect(text).not.toContain('Cannot POST');
    expect(console.warn).toHaveBeenCalledWith('[live-queue] action failed', { action: 'call', status: 404, code: 'UNKNOWN_ERROR' });
  });

  it('explains a stale entry and refreshes the list', async () => {
    let listCalls = 0;
    (apiFetch as jest.Mock).mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === 'POST') {
        const { ApiError } = require('../../../lib/api');
        throw new ApiError(409, { error: { code: 'INVALID_QUEUE_TRANSITION', message: 'This entry is not waiting to be called.' } });
      }
      listCalls += 1;
      return dashboard(queue);
    });
    await render();
    const before = listCalls;
    await press(t.callAction);
    expect(screenText()).toContain(t.queueEntryChangedError);
    expect(listCalls).toBeGreaterThan(before);
  });
});
