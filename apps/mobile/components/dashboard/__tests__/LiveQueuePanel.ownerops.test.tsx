/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
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
// One shared socket so a test can see which events the panel subscribed to.
const mockSocket = { on: jest.fn(), off: jest.fn() };
jest.mock('../../../lib/realtime', () => ({
  getRealtimeSocket: () => mockSocket,
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

const entry = (overrides: Record<string, unknown> = {}) => ({
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
  customerPhone: null,
  customerName: 'Ravi Kumar',
  arrivedAt: '2026-10-12T10:00:00.000Z',
  assignedStaffName: null,
  assignedChairLabel: null,
  preferredStaffId: null,
  preferredStaffName: null,
  activeServiceSessionId: null,
  joinedAt: '2026-10-12T10:00:00.000Z',
  calledAt: null,
  estimatedWaitRangeMinutes: null,
  turnApproaching: false,
  ...overrides,
});

let board: Record<string, unknown>;
let tree: ReturnType<typeof TestRenderer.create> | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = { props: Record<string, any>; findAll: (p: (n: Node) => boolean) => Node[] };
const nodes = (p: (n: Node) => boolean) => (tree!.root as unknown as Node).findAll(p);
const button = (title: string) => nodes((n) => n.props?.title === title && typeof n.props?.onPress === 'function')[0];
const byTestId = (id: string) => nodes((n) => n.props?.testID === id)[0];
const text = () => JSON.stringify(tree!.toJSON());
const posts = () => (apiFetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'PATCH').map(([path, init]) => ({ path, init }));
const press = async (title: string) => {
  const b = button(title);
  if (!b) throw new Error(`no button "${title}"`);
  await act(async () => {
    await b.props.onPress();
  });
};

async function render(props: Record<string, unknown> = {}) {
  await act(async () => {
    tree = TestRenderer.create(createElement(LiveQueuePanel, { salonId: 's1', ...props }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  board = {
    entries: [entry()],
    staffRoster: [{ id: 'st1', displayName: 'Sam', status: 'ACTIVE' }],
    chairs: [{ id: 'ch1', label: 'Chair 1', occupancy: 'FREE' }],
    services: [{ id: 'sv1', name: 'Beard' }],
    autoAssignEnabled: false,
  };
  (apiFetch as jest.Mock).mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.endsWith('/queue/auto-assign')) return { assigned: [{ queueEntryId: 'q1' }], skipped: [] };
    if (path.endsWith('/queue/customers')) return entry({ id: 'q9', tokenNumber: 9, customerName: 'Meera' });
    if (path.endsWith('/invoices')) return { id: 'inv1', number: 'S360-000001' };
    if (init?.method === 'POST' || init?.method === 'PATCH') return {};
    if (path.endsWith('/queue')) return board;
    return {};
  });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

describe('Live Queue board - owner operations', () => {
  it('no longer offers the confusing local-customer chair controls', async () => {
    await render();
    const screen = text();
    expect(screen).not.toMatch(/Seat local/i);
    expect(screen).not.toMatch(/Local customer/i);
    expect(screen).not.toMatch(/Free all local/i);
    expect(screen).not.toMatch(/walk-?in/i);
  });

  it('keeps Waiting, In service, Completed and the ended history as separate places', async () => {
    board = {
      ...board,
      sections: {
        waiting: [entry()],
        called: [],
        inService: [entry({ id: 'q2', tokenNumber: 8, status: 'IN_SERVICE', customerName: 'Anil', activeServiceSessionId: 'sess1', assignedStaffName: 'Sam', assignedChairLabel: 'Chair 1' })],
        completedToday: [entry({ id: 'q3', tokenNumber: 5, status: 'COMPLETED', customerName: 'Done Person' })],
        historyToday: [entry({ id: 'q4', tokenNumber: 4, status: 'CANCELLED', customerName: 'Gone Person' })],
      },
    };
    await render();
    const screen = text();
    expect(screen).toContain('Waiting (1)');
    expect(screen).toContain('In service (1)');
    expect(screen).toContain('Completed today (1)');
    expect(screen).toContain('Cancelled & expired (1)');
    // Ended visits are collapsed until asked for, and never mixed into the waiting list.
    expect(screen).not.toContain('Done Person');
    expect(screen).not.toContain('Gone Person');
    await act(async () => byTestId('toggle-completed').props.onPress());
    expect(text()).toContain('Done Person');
    await act(async () => byTestId('toggle-history').props.onPress());
    expect(text()).toContain('Gone Person');
  });

  it('adds a real queue customer through POST queue/customers with an idempotency key and consent', async () => {
    await render();
    await press('New Live Queue customer');
    await act(async () => byTestId('queue-customer-name').props.onChangeText('Meera Shah'));
    await act(async () => byTestId('queue-customer-phone').props.onChangeText('9876543210'));
    // A number without consent is refused before anything is sent.
    await press('Add to Live Queue');
    expect(posts().filter((p) => p.path.endsWith('/queue/customers'))).toHaveLength(0);
    expect(text()).toMatch(/agreed to be contacted/);
    await act(async () => byTestId('queue-customer-consent').props.onValueChange(true));
    await press('Add to Live Queue');
    const sent = posts().filter((p) => p.path.endsWith('/queue/customers'));
    expect(sent).toHaveLength(1);
    expect(sent[0].path).toBe('dashboard/salons/s1/queue/customers');
    expect(sent[0].init.headers['Idempotency-Key']).toBe('idem-key');
    const body = JSON.parse(sent[0].init.body);
    expect(body.name).toBe('Meera Shah');
    expect(body.contactConsent).toBe(true);
    expect(text()).toContain('was added to the Live Queue as #9');
  });

  it('assigns one customer with the allocation engine of the server, not a second client-side one', async () => {
    await render();
    await press('Assign automatically');
    expect(posts().map((p) => p.path)).toContain('dashboard/queue-entries/q1/auto-assign');
  });

  it('seats everyone in the shop at once and reports the outcome in words', async () => {
    await render();
    await press('Assign all automatically');
    expect(posts().map((p) => p.path)).toContain('dashboard/salons/s1/queue/auto-assign');
    expect(text()).toContain('Assigned 1 customer. The barber starts each service.');
  });

  it('only offers automatic seating for customers who are actually in the shop', async () => {
    board = { ...board, entries: [entry({ arrivedAt: null })] };
    await render();
    expect(button('Assign automatically')).toBeUndefined();
    expect(button('Assign all automatically')).toBeUndefined();
    expect(button(uiMarkArrived())).toBeDefined();
  });

  it('lets the owner switch automatic seating on, and staff do not see the switch', async () => {
    await render({ role: 'owner' });
    await act(async () => byTestId('auto-assign-switch').props.onValueChange(true));
    const patch = posts().find((p) => p.path === 'dashboard/salons/s1/queue/settings');
    expect(patch?.init.method).toBe('PATCH');
    expect(JSON.parse(patch!.init.body)).toEqual({ autoAssignEnabled: true });
    await act(async () => tree!.unmount());
    tree = undefined;
    await render({ role: 'staff' });
    expect(byTestId('auto-assign-switch')).toBeUndefined();
  });

  it('creates the invoice for a completed visit once, then offers to open it', async () => {
    board = { ...board, sections: { waiting: [], called: [], inService: [], completedToday: [entry({ id: 'q3', tokenNumber: 5, status: 'COMPLETED' })], historyToday: [] } };
    const opened: string[] = [];
    await render({ onOpenInvoice: (id: string) => opened.push(id) });
    await act(async () => byTestId('toggle-completed').props.onPress());
    await press('Create invoice');
    const created = posts().find((p) => p.path === 'dashboard/salons/s1/invoices');
    expect(JSON.parse(created!.init.body)).toEqual({ queueEntryId: 'q3' });
    await press('View invoice S360-000001');
    expect(opened).toEqual(['inv1']);
  });

  it('can still release a chair that an old manual "local" occupancy is holding', async () => {
    board = { ...board, chairs: [{ id: 'ch1', label: 'Chair 1', occupancy: 'LOCAL' }] };
    await render();
    await press('Free chair');
    expect(posts().some((p) => p.path.endsWith('/chairs/ch1/free-local') || p.path.includes('ch1'))).toBe(true);
  });

  it('never lets an older snapshot roll the board back', async () => {
    board = { ...board, revision: 200, entries: [entry({ customerName: 'Newest' })] };
    const handle: { current: { refresh: () => Promise<void> } | null } = { current: null };
    await act(async () => {
      tree = TestRenderer.create(createElement(LiveQueuePanel, { salonId: 's1', ref: handle }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(text()).toContain('Newest');
    // A slower, older response arrives afterwards (e.g. from a refetch that was already in flight).
    board = { ...board, revision: 100, entries: [entry({ customerName: 'Stale' })] };
    await act(async () => {
      await handle.current!.refresh();
    });
    expect(text()).toContain('Newest');
    expect(text()).not.toContain('Stale');
  });
});


// ---------------------------------------------------------------------------------------------------
// Owner-operations corrective mission: ASSIGNED is not IN SERVICE.
//   WAITING -> ASSIGNED (a barber and chair are reserved) -> IN SERVICE (the barber starts) -> COMPLETED
// ---------------------------------------------------------------------------------------------------
describe('Live Queue board - assigned is not in service', () => {
  const assigned = (overrides: Record<string, unknown> = {}) =>
    entry({
      id: 'qa',
      tokenNumber: 11,
      status: 'CALLED',
      phase: 'ASSIGNED',
      position: null,
      customerName: 'Asha Rao',
      assignedStaffId: 'st1',
      assignedChairId: 'ch1',
      assignedStaffName: 'Sam',
      assignedChairLabel: 'Chair 1',
      assignedAt: '2026-10-13T10:00:00.000Z',
      serviceStartedAt: null,
      ...overrides,
    });
  const seated = entry({ id: 'qs', tokenNumber: 12, status: 'IN_SERVICE', phase: 'IN_SERVICE', position: null, customerName: 'Serviced Sam', activeServiceSessionId: 'sess1', assignedStaffId: 'st2', assignedStaffName: 'Ria', assignedChairLabel: 'Chair 2' });

  beforeEach(() => {
    board = {
      ...board,
      sections: { waiting: [entry()], called: [], assigned: [assigned()], inService: [seated], completedToday: [], historyToday: [] },
      staffRoster: [
        { id: 'st1', displayName: 'Sam', status: 'ACTIVE', availabilityState: 'RESERVED' },
        { id: 'st2', displayName: 'Ria', status: 'ACTIVE', availabilityState: 'IN_SERVICE' },
        { id: 'st3', displayName: 'Meena', status: 'ACTIVE', availabilityState: 'AVAILABLE' },
      ],
      chairs: [
        { id: 'ch1', label: 'Chair 1', occupancy: 'FREE', reservedForEntryId: 'qa', reservedForTokenNumber: 11 },
        { id: 'ch2', label: 'Chair 2', occupancy: 'FASTQUE', tokenNumber: 12 },
        { id: 'ch3', label: 'Chair 3', occupancy: 'FREE' },
      ],
      autoAssignEnabled: true,
    };
  });

  it('keeps Waiting, Assigned and In service as three separate places with exact counts', async () => {
    await render();
    const screen = text();
    expect(screen).toContain('Waiting (1)');
    expect(screen).toContain('Assigned (1)');
    expect(screen).toContain('In service (1)');
    // each customer is listed once, under their own heading
    expect(screen.match(/Asha Rao/g)).toHaveLength(1);
    expect(screen.match(/Ravi Kumar/g)).toHaveLength(1);
    expect(screen.match(/Serviced Sam/g)).toHaveLength(1);
  });

  it('shows an assigned customer as assigned and NOT started, with their barber and chair', async () => {
    await render();
    expect(byTestId('entry-status-11').props.children).toBe('Assigned · not started');
    expect(text()).toContain('Assigned to: Sam - Chair 1');
    expect(byTestId('service-not-started-11')).toBeDefined();
    // a seated customer reads "In service", and only they have Complete
    expect(byTestId('entry-status-12').props.children).toBe('In service');
  });

  it('Start service starts the assigned customer through the explicit start action (not through assign)', async () => {
    await render();
    await press('Start service');
    const started = posts().find((p) => p.path === 'dashboard/queue-entries/qa/start-service');
    expect(started).toBeDefined();
    expect(started!.init.headers['Idempotency-Key']).toBe('idem-key');
    expect(posts().some((p) => p.path.endsWith('/assign'))).toBe(false);
    expect(text()).toContain('Service started.');
  });

  it('a waiting customer is told they are waiting for available staff (or to be assigned when automatic assignment is off)', async () => {
    await render();
    expect(byTestId('waiting-for-staff-7').props.children).toBe('Waiting for available staff');
    await act(async () => tree!.unmount());
    tree = undefined;
    board = { ...board, autoAssignEnabled: false };
    await render();
    expect(byTestId('waiting-for-staff-7').props.children).toBe('Waiting to be assigned');
  });

  it('a waiting customer has no Start service, and neither does an in-service one', async () => {
    board = { ...board, sections: { waiting: [entry()], called: [], assigned: [], inService: [seated], completedToday: [], historyToday: [] } };
    await render();
    expect(button('Start service')).toBeUndefined();
  });

  it('the owner may start anyone\'s customer; a barber only their own', async () => {
    await render({ role: 'staff', myStaffId: 'someone-else' });
    expect(button('Start service')).toBeUndefined();
    await act(async () => tree!.unmount());
    tree = undefined;
    await render({ role: 'staff', myStaffId: 'st1' });
    expect(button('Start service')).toBeDefined();
    await act(async () => tree!.unmount());
    tree = undefined;
    await render({ role: 'owner' });
    expect(button('Start service')).toBeDefined();
  });

  it('shows the chair held by the assigned customer as reserved, and offers only free chairs (plus their own) when changing', async () => {
    await render();
    expect(text()).toContain('Reserved · not started · #11');
    await press('Change barber & chair');
    const chipLabels = nodes((n) => typeof n.props?.onPress === 'function' && n.props?.style !== undefined)
      .flatMap((n) => n.findAll((c) => typeof c.props?.children === 'string').map((c) => c.props.children as string));
    expect(chipLabels).toContain('Chair 1'); // the customer's own held chair
    expect(chipLabels).toContain('Chair 3');
    expect(chipLabels).not.toContain('Chair 2'); // occupied by a service in progress
  });

  it('manually assigning sends startService:false so the service is not started by the assignment', async () => {
    board = { ...board, sections: { waiting: [], called: [entry({ status: 'CALLED' })], assigned: [], inService: [], completedToday: [], historyToday: [] } };
    await render();
    await press('Assign');
    const chip = (label: string) => nodes((n) => typeof n.props?.onPress === 'function' && n.findAll((c) => Boolean((c as unknown as { children?: unknown[] }).children?.includes(label))).length > 0)[0];
    await act(async () => chip('Meena').props.onPress());
    await act(async () => chip('Chair 3').props.onPress());
    await press('Confirm assignment');
    const post = posts().find((p) => p.path === 'dashboard/queue-entries/q1/assign');
    expect(JSON.parse(post!.init.body)).toMatchObject({ staffId: 'st3', chairId: 'ch3', startService: false });
  });

  it('refuses nothing silently: a refused start shows the server\'s own reason', async () => {
    (apiFetch as jest.Mock).mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith('/start-service')) {
        const { ApiError } = jest.requireMock('../../../lib/api') as { ApiError: new (status: number, body: { error: { code: string; message: string } }) => Error };
        throw new ApiError(403, { error: { code: 'NOT_YOUR_ASSIGNMENT', message: 'This customer is assigned to another barber.' } });
      }
      if (init?.method === 'POST' || init?.method === 'PATCH') return {};
      return path.endsWith('/queue') ? board : {};
    });
    await render();
    await press('Start service');
    expect(byTestId('inline-error').props.children).toBe('This customer is assigned to another barber.');
  });

  it('the automatic assignment switch shows what the server says; and is absent when the server does not report it', async () => {
    await render({ role: 'owner' });
    expect(byTestId('auto-assign-switch').props.value).toBe(true);
    await act(async () => tree!.unmount());
    tree = undefined;
    board = { ...board, autoAssignEnabled: false };
    await render({ role: 'owner' });
    expect(byTestId('auto-assign-switch').props.value).toBe(false);
    await act(async () => tree!.unmount());
    tree = undefined;
    const { autoAssignEnabled: _omitted, ...withoutFlag } = board;
    board = withoutFlag;
    await render({ role: 'owner' });
    expect(byTestId('auto-assign-switch')).toBeUndefined();
  });

  it('refreshes on every realtime event that can move a customer between the places', async () => {
    await render();
    const subscribed = mockSocket.on.mock.calls.map(([name]) => name);
    for (const name of ['queue.updated', 'queue.entry.called', 'queue.entry.reassigned', 'queue.entry.no_show', 'queue.entry.expired', 'staff.status.changed']) {
      expect(subscribed).toContain(name);
    }
  });
});

describe('Live Queue board - Hindi', () => {
  it('shows the new controls in Hindi when the account language is Hindi', async () => {
    const shared = require('@barbercue/shared') as { uiStringsFor: (l: string) => Record<string, string> };
    const hi = shared.uiStringsFor('HI');
    board = {
      ...board,
      sections: { waiting: [], called: [], assigned: [{ ...entry(), id: 'qa', tokenNumber: 11, status: 'CALLED', phase: 'ASSIGNED', position: null, assignedStaffId: 'st1', assignedStaffName: 'Sam', assignedChairLabel: 'Chair 1' }], inService: [], completedToday: [], historyToday: [] },
      autoAssignEnabled: true,
    };
    const lang = jest.requireMock('../../../lib/language-context') as { useLanguage: () => unknown };
    jest.spyOn(lang, 'useLanguage').mockReturnValue({ language: 'HI', t: hi });
    await render();
    const screen = text();
    expect(screen).toContain(hi.startServiceAction);
    expect(screen).toContain(hi.assignedNotStartedBadge);
    expect(screen).toContain(hi.automaticAssignmentLabel);
    expect(screen).toContain(hi.serviceNotStartedHint);
    expect(screen).not.toContain('Start service');
  });
});

function uiMarkArrived(): string {
  return require('@barbercue/shared').uiStringsFor('EN').markArrivedAction;
}
