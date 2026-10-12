/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { OwnerOverviewPanel } from '../OwnerOverviewPanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    status = 500;
  },
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
  const { View, Text, Pressable } = require('react-native');
  const { createElement: h } = require('react');
  return {
    InlineError: ({ message }: { message: string }) => h(Text, { testID: 'inline-error' }, message),
    Skeleton: View,
    PremiumCard: ({ children, testID }: { children: unknown; testID?: string }) => h(View, { testID }, children),
    PremiumButton: ({ title, onPress, testID }: { title: string; onPress: () => void; testID?: string }) => h(Pressable, { title, onPress, testID }, h(Text, null, title)),
  };
});

function overview(overrides: Record<string, unknown> = {}) {
  return {
    salonId: 's1',
    salonName: 'Studio 360 Barbers',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    localDate: '2026-10-13',
    generatedAt: '2026-10-13T08:00:00.000Z',
    kpis: {
      appointmentsToday: 4,
      customersServedToday: 2,
      waitingInQueue: 3,
      inService: 2,
      availableBarbers: 1,
      busyBarbers: 2,
      activeStaff: 3,
      completedServicesToday: 2,
      cancelledToday: 1,
      recordedRevenueToday: 1250,
      recordedPaymentsToday: 2,
    },
    revenue: {
      currency: 'INR',
      hasRecordedPayments: true,
      daily: [
        { date: '2026-10-11', amount: 500 },
        { date: '2026-10-12', amount: 1000 },
        { date: '2026-10-13', amount: 1250 },
      ],
      weekly: [],
      monthly: [],
      today: { current: 1250, previous: 1000, changePercent: 25 },
      thisWeek: { current: 2750, previous: 0, changePercent: null },
      thisMonth: { current: 17660, previous: 9000, changePercent: 96.2 },
      estimatedServiceValueToday: 700,
      unpaidInvoiceCount: 2,
      unpaidInvoiceTotal: 1460,
    },
    topServices: [{ serviceId: 'a', name: 'Classic Haircut', completedCount: 9, averageChargedAmount: 250, recordedRevenue: 2250, estimatedValue: 2250, popularityPercent: 40 }],
    staffPerformance: [{ staffId: 'st1', displayName: 'Arjun Mehta', status: 'ACTIVE', availabilityState: 'IN_SERVICE', completedToday: 2, completedLast30Days: 40, estimatedValueLast30Days: 9000, rating: null }],
    todaysSchedule: [{ id: 'b1', kind: 'BOOKING', slotStart: '2026-10-13T09:30:00.000Z', slotEnd: '2026-10-13T10:00:00.000Z', status: 'CONFIRMED', source: 'IN_SHOP', serviceNames: ['Haircut', 'Beard'], customerLabel: 'Ravi', staffName: 'Arjun Mehta' }],
    queueSummary: { waiting: 3, called: 0, inService: 2, completedToday: 2, cancelledToday: 0, expiredToday: 0, noShowToday: 0 },
    cancellationSummary: { windowDays: 30, total: 6, ratePercent: 54.5, byActor: { CUSTOMER: 3, OWNER: 1, STAFF: 1, SYSTEM: 0, ADMIN: 0, UNKNOWN: 1 } },
    branches: [],
    settings: { autoAssignEnabled: false, showPhoneToCustomers: true, hasPaymentQr: false, hasBillingProfile: true },
    ...overrides,
  };
}

const actions = {
  onNewQueueCustomer: jest.fn(),
  onNewAppointment: jest.fn(),
  onOpenQueue: jest.fn(),
  onOpenBookings: jest.fn(),
  onOpenInvoices: jest.fn(),
  onOpenCancellations: jest.fn(),
  onOpenStaff: jest.fn(),
  onOpenAnalytics: jest.fn(),
};

let tree: ReturnType<typeof TestRenderer.create> | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = { props: Record<string, any>; findAll: (p: (n: Node) => boolean) => Node[] };
const nodes = (p: (n: Node) => boolean) => (tree!.root as unknown as Node).findAll(p);
const byTestId = (id: string) => nodes((n) => n.props?.testID === id)[0];
const text = () => JSON.stringify(tree!.toJSON());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const textOf = (node: any): string => (typeof node === 'string' ? node : Array.isArray(node?.children) ? node.children.map(textOf).join(' ') : '');

async function render() {
  await act(async () => {
    tree = TestRenderer.create(createElement(OwnerOverviewPanel, { salonId: 's1', actions }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (apiFetch as jest.Mock).mockResolvedValue(overview());
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
});

describe('owner overview', () => {
  it('reads the real overview endpoint for the selected shop', async () => {
    await render();
    expect((apiFetch as jest.Mock).mock.calls[0][0]).toBe('dashboard/salons/s1/overview');
  });

  it('shows all ten operating figures from the server, not invented ones', async () => {
    await render();
    const expected: Record<string, string> = {
      'kpi-appointments': '4',
      'kpi-served': '2',
      'kpi-waiting': '3',
      'kpi-inservice': '2',
      'kpi-revenue': '₹1,250',
      'kpi-available': '1',
      'kpi-busy': '2',
      'kpi-active': '3',
      'kpi-completed': '2',
      'kpi-cancelled': '1',
    };
    for (const [id, value] of Object.entries(expected)) {
      expect(byTestId(id).props.accessibilityLabel).toContain(`: ${value}.`);
    }
    expect(text()).toContain('Studio 360 Barbers');
  });

  it('compares with the earlier period only when there is one, and never prints a made-up percentage', async () => {
    await render();
    const week = textOf(byTestId('period-This week'));
    expect(week).toContain('No earlier data');
    expect(week).not.toContain('%');
    expect(textOf(byTestId('period-Today'))).toContain('+25%');
  });

  it('keeps the estimated value of services apart from revenue and says what it is', async () => {
    await render();
    const note = textOf(byTestId('estimated-value'));
    expect(note).toContain('₹700');
    expect(note).toContain('not revenue until you record the payment');
  });

  it('draws an honest empty state instead of zero bars when no payment was ever recorded', async () => {
    (apiFetch as jest.Mock).mockResolvedValue(overview({ revenue: { ...overview().revenue, hasRecordedPayments: false, daily: [{ date: '2026-10-13', amount: 0 }] } }));
    await render();
    expect(byTestId('revenue-empty')).toBeDefined();
    expect(byTestId('revenue-bars')).toBeUndefined();
  });

  it('opens invoices from the awaiting-payment note, and routes every quick action', async () => {
    await render();
    await act(async () => byTestId('unpaid-invoices').props.onPress());
    expect(actions.onOpenInvoices).toHaveBeenCalledTimes(1);
    const press = async (title: string) => act(async () => nodes((n) => n.props?.title === title && typeof n.props?.onPress === 'function')[0].props.onPress());
    await press('New Live Queue customer');
    await press('New in-shop appointment');
    await press('Open Live Queue');
    await press('Analytics');
    expect(actions.onNewQueueCustomer).toHaveBeenCalled();
    expect(actions.onNewAppointment).toHaveBeenCalled();
    expect(actions.onOpenQueue).toHaveBeenCalled();
    expect(actions.onOpenAnalytics).toHaveBeenCalled();
  });

  it('shows in-shop appointments in today\'s schedule and cancellation attribution without guessing', async () => {
    await render();
    const schedule = textOf(byTestId('overview-schedule'));
    expect(schedule).toContain('In-shop');
    expect(schedule).toContain('Haircut + Beard');
    const cancellations = textOf(byTestId('overview-cancellations'));
    expect(cancellations).toContain('Not recorded');
    expect(cancellations).toContain('54.5%');
  });

  it('only shows the branch comparison for an owner of more than one shop', async () => {
    await render();
    expect(byTestId('overview-branches')).toBeUndefined();
    await act(async () => tree!.unmount());
    tree = undefined;
    (apiFetch as jest.Mock).mockResolvedValue(
      overview({
        branches: [
          { salonId: 's1', name: 'Studio 360', waiting: 3, inService: 2, completedToday: 2, recordedRevenueToday: 1250, currency: 'INR' },
          { salonId: 's2', name: 'Second Shop', waiting: 0, inService: 0, completedToday: 0, recordedRevenueToday: 0, currency: 'INR' },
        ],
      }),
    );
    await render();
    expect(textOf(byTestId('overview-branches'))).toContain('Second Shop');
  });

  it('says so when the overview cannot be loaded, with a way to retry', async () => {
    (apiFetch as jest.Mock).mockRejectedValue(new Error('boom'));
    await render();
    expect(text()).toContain('Could not load your shop overview.');
    expect(nodes((n) => n.props?.title === 'Try again')[0]).toBeDefined();
  });
});
