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

  it('seats one customer with the server\'s allocation engine, not a second client-side one', async () => {
    await render();
    await press('Assign automatically');
    expect(posts().map((p) => p.path)).toContain('dashboard/queue-entries/q1/auto-assign');
  });

  it('seats everyone in the shop at once and reports the outcome in words', async () => {
    await render();
    await press('Assign all automatically');
    expect(posts().map((p) => p.path)).toContain('dashboard/salons/s1/queue/auto-assign');
    expect(text()).toContain('Seated 1 customer.');
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

function uiMarkArrived(): string {
  return require('@barbercue/shared').uiStringsFor('EN').markArrivedAction;
}
