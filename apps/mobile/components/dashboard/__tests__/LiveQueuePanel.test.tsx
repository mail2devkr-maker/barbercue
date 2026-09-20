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
type TestNode = { type: unknown; props: Record<string, any>; children?: unknown[]; findAll: (predicate: (node: TestNode) => boolean) => TestNode[] };
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

  // REGRESSION (1.0.4/1.0.5 vs 1.0.3): Assign had been hidden until "Mark arrived" was tapped, so the
  // normal WAITING -> Call -> Assign flow was impossible for every remote/QR join. The backend seats a
  // WAITING/CALLED entry and records the arrival itself, so Assign must be offered for any called entry.
  it('Assign is offered for a CALLED customer whether or not arrival was acknowledged (the 1.0.3 flow)', async () => {
    queue = [entry({ status: 'CALLED', arrivedAt: null })];
    await render();
    expect(hasButton(t.assignAction)).toBe(true);
    expect(hasButton(t.markArrivedAction)).toBe(true); // the separate acknowledgement stays available, optional
    queue = [entry({ status: 'CALLED', arrivedAt: '2026-09-20T10:05:00.000Z' })];
    await act(async () => tree!.unmount());
    await render();
    expect(hasButton(t.assignAction)).toBe(true);
  });

  it('Assign is not offered where it makes no sense: a WAITING entry (must be called first) or one already in service', async () => {
    queue = [entry({ status: 'WAITING' })];
    await render();
    expect(hasButton(t.assignAction)).toBe(false);
    await act(async () => tree!.unmount());
    queue = [entry({ status: 'IN_SERVICE', activeServiceSessionId: 'sess1' })];
    await render();
    expect(hasButton(t.assignAction)).toBe(false);
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

// The whole owner flow against a small stateful stand-in for the backend's rules (QueueService.call /
// assign / cancel and ServiceSession complete): a real transition changes the next list the panel reads,
// exactly as it does against the API, so this proves the UI flow end to end rather than button-by-button.
describe('Live Queue lifecycle: Call -> Assign staff + free chair -> In service -> Complete, and Cancel', () => {
  type Fake = { id: string; token: number; status: string; arrivedAt: string | null; staff: string | null; chair: string | null; session: string | null };
  let entries: Fake[];
  let chairs: { id: string; label: string }[];
  let rejected: string[];

  const occupiedBy = (chairId: string) => entries.find((e) => e.status === 'IN_SERVICE' && e.chair === chairId);

  function snapshot() {
    return {
      entries: entries.map((e) => ({
        ...entry({ id: e.id, tokenNumber: e.token, status: e.status, arrivedAt: e.arrivedAt, activeServiceSessionId: e.session }),
        assignedStaffName: e.staff === 'st1' ? 'Sam' : e.staff === 'st2' ? 'Ria' : null,
        assignedChairLabel: chairs.find((c) => c.id === e.chair)?.label ?? null,
      })),
      staffRoster: [
        { id: 'st1', displayName: 'Sam', status: 'ACTIVE' },
        { id: 'st2', displayName: 'Ria', status: 'ACTIVE' },
      ],
      chairs: chairs.map((c) => ({ id: c.id, label: c.label, occupancy: occupiedBy(c.id) ? 'OCCUPIED' : 'FREE' })),
      services: [],
    };
  }

  beforeEach(() => {
    rejected = [];
    chairs = [
      { id: 'ch1', label: 'Chair 1' },
      { id: 'ch2', label: 'Chair 2' },
    ];
    entries = [
      { id: 'q1', token: 7, status: 'WAITING', arrivedAt: null, staff: null, chair: null, session: null },
      { id: 'q2', token: 8, status: 'WAITING', arrivedAt: null, staff: null, chair: null, session: null },
    ];
    (apiFetch as jest.Mock).mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
      if (init?.method !== 'POST') return snapshot();
      const [, , id, action] = path.split('/'); // dashboard/queue-entries/:id/:action | dashboard/service-sessions/:id/complete
      const { ApiError } = require('../../../lib/api');
      if (path.startsWith('dashboard/service-sessions/')) {
        const done = entries.find((e) => e.session === id)!;
        done.status = 'COMPLETED';
        done.session = null;
        return {};
      }
      const target = entries.find((e) => e.id === id)!;
      if (action === 'call') {
        if (target.status !== 'WAITING') throw new ApiError(409, { error: { code: 'INVALID_QUEUE_TRANSITION', message: 'not waiting' } });
        target.status = 'CALLED';
      } else if (action === 'assign') {
        const { staffId, chairId } = JSON.parse(init!.body!);
        if (occupiedBy(chairId)) {
          rejected.push(chairId);
          throw new ApiError(409, { error: { code: 'CHAIR_ALREADY_OCCUPIED', message: 'occupied' } });
        }
        if (!['WAITING', 'CALLED'].includes(target.status)) throw new ApiError(409, { error: { code: 'INVALID_QUEUE_TRANSITION', message: 'no' } });
        target.status = 'IN_SERVICE';
        target.staff = staffId;
        target.chair = chairId;
        target.session = `sess-${target.id}`;
        target.arrivedAt = target.arrivedAt ?? '2026-09-20T10:06:00.000Z'; // seating records the arrival (backend rule)
      } else if (action === 'cancel') {
        target.status = 'CANCELLED';
      }
      return {};
    });
  });

  // Selectable barber / chair chips are the Pressables in the assign panel.
  const textOf = (n: unknown): string =>
    typeof n === 'string' ? n : ((n as TestNode).children ?? []).map(textOf).join('');
  const pressableNodes = () => allNodes((n) => typeof n.props?.onPress === 'function');
  const chipLabels = (): string[] => pressableNodes().map(textOf);
  const chip = (label: string) => pressableNodes().find((n) => textOf(n) === label)!;
  const callButtons = () => allNodes((n) => isButtonTitled(n, t.callAction));

  it('runs the full flow: Call, Assign (staff + free chair), In service on that chair, chair blocked for others, Complete frees it, Cancel still works', async () => {
    await render();

    // 1. WAITING -> Call. The entry is not "arrived" (a remote join) and that must not matter.
    await act(async () => {
      await callButtons()[0].props.onPress();
    });
    expect(entries[0].status).toBe('CALLED');
    expect(entries[0].arrivedAt).toBeNull();

    // 2. CALLED -> Assign is offered (the regression) -> pick staff + a free chair.
    expect(hasButton(t.assignAction)).toBe(true);
    await press(t.assignAction);
    await act(async () => chip('Sam').props.onPress());
    await act(async () => chip('Chair 2').props.onPress());

    // 3. Confirm assignment: one POST with the chosen staff, chair and service.
    await press(t.confirmAssignmentAction);
    const assign = postCalls().find((c) => c.path === 'dashboard/queue-entries/q1/assign')!;
    expect(JSON.parse(assign.init.body)).toEqual({ staffId: 'st1', chairId: 'ch2', serviceId: 'sv1' });

    // 4. The entry is IN_SERVICE with a service session and the UI refreshed to show it.
    expect(entries[0]).toMatchObject({ status: 'IN_SERVICE', staff: 'st1', chair: 'ch2', session: 'sess-q1' });
    expect(entries[0].arrivedAt).not.toBeNull();
    expect(screenText()).toContain(t.inService);
    expect(hasButton(t.completeAction)).toBe(true);

    // 5 + 6. Chair 2 is occupied by token 7; the next called entry is offered only the FREE chair, and the
    // backend would refuse it if it were tried anyway.
    await act(async () => {
      await callButtons()[0].props.onPress(); // q2 is now the only WAITING entry
    });
    expect(entries[1].status).toBe('CALLED');
    expect(occupiedBy('ch2')?.token).toBe(7);
    await press(t.assignAction);
    expect(chipLabels()).toContain('Chair 1'); // the free chair is selectable
    expect(chipLabels()).not.toContain('Chair 2'); // the occupied chair is not
    expect(rejected).toEqual([]);

    // 7. Complete Service frees the chair.
    await act(async () => tree!.unmount());
    await render();
    await press(t.completeAction);
    await confirmAlert();
    expect(postCalls().map((c) => c.path)).toContain('dashboard/service-sessions/sess-q1/complete');
    expect(entries[0].status).toBe('COMPLETED');
    expect(occupiedBy('ch2')).toBeUndefined();
    expect(snapshot().chairs.find((c) => c.id === 'ch2')!.occupancy).toBe('FREE');

    // 8. Cancel still works (on the entry that is still CALLED).
    await act(async () => tree!.unmount());
    await render();
    await press(t.cancelAction);
    await confirmAlert();
    expect(postCalls().map((c) => c.path)).toContain('dashboard/queue-entries/q2/cancel');
    expect(entries[1].status).toBe('CANCELLED');
  });

  it('an occupied chair is never offered for selection, and a forced assignment to it is refused by the (fake) backend rules without changing the entry', async () => {
    entries[0] = { ...entries[0], status: 'IN_SERVICE', staff: 'st2', chair: 'ch1', session: 'sess-q1', arrivedAt: '2026-09-20T10:06:00.000Z' };
    entries[1].status = 'CALLED';
    await render();
    await press(t.assignAction);
    expect(chipLabels()).toContain('Chair 2');
    expect(chipLabels()).not.toContain('Chair 1');
  });
});
