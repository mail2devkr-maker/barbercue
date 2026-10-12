/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Alert } from 'react-native';
import { StaffMyDayCard } from '../../dashboard/StaffMyDayCard';
import { StaffMemberRow } from '../StaffMemberRow';
import MyInvoicesScreen from '../../../screens/MyInvoicesScreen';
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
jest.mock('../../../lib/realtime', () => ({
  getRealtimeSocket: () => ({ on: jest.fn(), off: jest.fn() }),
  joinSalonRoom: jest.fn(),
  onReconnect: () => () => undefined,
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('../ShopSetupSections', () => ({ styles: {} }));
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement: h } = require('react');
  return {
    Card: View,
    Screen: ({ children }: { children: unknown }) => h(View, null, children),
    SectionHeader: ({ title }: { title: string }) => h(Text, null, title),
    Button: require('../../ui/Button').Button,
    EmptyState: ({ title }: { title: string }) => h(Text, null, title),
    Skeleton: View,
    InlineError: ({ message }: { message: string }) => h(Text, { testID: 'inline-error' }, message),
    PremiumButton: ({ title, onPress, testID, loading }: { title: string; onPress: () => void; testID?: string; loading?: boolean }) => h(Pressable, { title, onPress, testID, disabled: loading }, h(Text, null, title)),
  };
});

let tree: ReturnType<typeof TestRenderer.create> | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = { props: Record<string, any>; findAll: (p: (n: Node) => boolean) => Node[] };
const nodes = (p: (n: Node) => boolean) => (tree!.root as unknown as Node).findAll(p);
const byTestId = (id: string) => nodes((n) => n.props?.testID === id)[0];
const button = (title: string) => nodes((n) => n.props?.title === title && typeof n.props?.onPress === 'function')[0];
const text = () => JSON.stringify(tree!.toJSON());
const writes = () => (apiFetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'POST').map(([path, init]) => ({ path, init }));
async function mount(element: ReturnType<typeof createElement>) {
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const work = (overrides: Record<string, unknown> = {}) => ({
  salonId: 's1',
  salonName: 'Studio 360',
  staffId: 'st1',
  displayName: 'Arjun Mehta',
  status: 'ACTIVE',
  availabilityState: 'IN_SERVICE',
  current: { queueEntryId: 'q61', serviceSessionId: 'sess61', tokenNumber: 61, customerLabel: 'Rohit S.', customerPhone: null, serviceName: 'Haircut + Beard', startedAt: '2026-10-12T17:30:00.000Z', status: 'IN_SERVICE', chairLabel: 'Chair 1' },
  waiting: [
    { queueEntryId: 'q65', serviceSessionId: null, tokenNumber: 65, customerLabel: 'Deepak J.', customerPhone: null, serviceName: 'Head Massage', startedAt: null, status: 'WAITING', chairLabel: null, eligible: false, position: 1 },
    { queueEntryId: 'q63', serviceSessionId: null, tokenNumber: 63, customerLabel: 'Vikram Rao', customerPhone: null, serviceName: 'Classic Haircut', startedAt: null, status: 'WAITING', chairLabel: null, eligible: true, position: 2 },
  ],
  appointmentsToday: [{ bookingId: 'b1', slotStart: '2026-10-12T19:00:00.000Z', slotEnd: '2026-10-12T19:30:00.000Z', status: 'CONFIRMED', serviceNames: ['Haircut'], customerLabel: 'Meera', customerPhone: null, source: 'IN_SHOP' }],
  completedToday: 3,
  revision: 100,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

describe('barber: my day', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return {};
      if (path === 'dashboard/salons/s1/staff/me/work') return work();
      return {};
    });
  });

  it('shows the barber their own current service, who they may take and their appointments', async () => {
    await mount(createElement(StaffMyDayCard, { salonId: 's1' }));
    const screen = text();
    expect(screen).toContain('#61 · Rohit S.');
    expect(screen).toContain('Waiting you can take (1)');
    expect(screen).toContain('Vikram Rao');
    expect(screen).not.toContain('Deepak J.'); // not eligible for this barber
    expect(screen).toContain('In-shop');
  });

  it('completes the current service through the existing session route, only after asking', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onChanged = jest.fn();
    await mount(createElement(StaffMyDayCard, { salonId: 's1', onChanged }));
    await act(async () => button('Complete service').props.onPress());
    expect(writes()).toHaveLength(0);
    const confirm = (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((b) => b.onPress)!;
    await act(async () => confirm.onPress!());
    expect(writes().map((w) => w.path)).toEqual(['dashboard/service-sessions/sess61/complete']);
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows nothing for a user who has no barber record at this shop', async () => {
    const { ApiError } = require('../../../lib/api');
    (apiFetch as jest.Mock).mockRejectedValue(new ApiError(404, { error: { code: 'NOT_FOUND', message: 'nope' } }));
    await mount(createElement(StaffMyDayCard, { salonId: 's1' }));
    expect(text()).toBe('null');
  });

  it('lets a free barber take the next customer, and never offers it while serving', async () => {
    await mount(createElement(StaffMyDayCard, { salonId: 's1' }));
    expect(button('Take next customer')).toBeUndefined();
    await act(async () => tree!.unmount());
    tree = undefined;
    (apiFetch as jest.Mock).mockImplementation(async (path: string) => (path.endsWith('/staff/me/work') ? work({ current: null, availabilityState: 'AVAILABLE', revision: 101 }) : {}));
    await mount(createElement(StaffMyDayCard, { salonId: 's1' }));
    await act(async () => button('Take next customer').props.onPress());
    expect(writes().map((w) => w.path)).toContain('dashboard/salons/s1/queue/take-next');
  });
});

describe('owner: barber access', () => {
  const member = (overrides: Record<string, unknown> = {}) =>
    ({ id: 'st2', displayName: 'Bilal Khan', phone: null, email: 'b@x.test', roleInSalon: 'BARBER', status: 'ACTIVE', hasPassword: true, accessRevoked: false, bio: null, photoUrl: null, yearsExperience: null, ...overrides }) as never;

  it('asks before removing access, then removes it through the access route', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({});
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onChanged = jest.fn();
    await mount(createElement(StaffMemberRow, { salonId: 's1', member: member(), invitePendingSuffix: '(invited)', onChanged }));
    await act(async () => byTestId('staff-access-st2').props.onPress());
    expect(writes()).toHaveLength(0);
    expect(alert.mock.calls[0][0]).toContain('Bilal Khan');
    const confirm = (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((b) => b.onPress)!;
    await act(async () => confirm.onPress!());
    expect(writes().map((w) => w.path)).toEqual(['dashboard/salons/s1/staff/st2/access/revoke']);
    expect(onChanged).toHaveBeenCalled();
  });

  it('restores access in one tap and labels a removed barber', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({});
    await mount(createElement(StaffMemberRow, { salonId: 's1', member: member({ accessRevoked: true }), invitePendingSuffix: '', onChanged: jest.fn() }));
    expect(text()).toContain('Login access removed');
    await act(async () => byTestId('staff-access-st2').props.onPress());
    expect(writes().map((w) => w.path)).toEqual(['dashboard/salons/s1/staff/st2/access/restore']);
  });

  it('shows the server\'s reason when removal is refused (for example mid-service) and changes nothing', async () => {
    const { ApiError } = require('../../../lib/api');
    (apiFetch as jest.Mock).mockRejectedValue(new ApiError(409, { error: { code: 'X', message: 'This barber is serving a customer right now.' } }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onChanged = jest.fn();
    await mount(createElement(StaffMemberRow, { salonId: 's1', member: member(), invitePendingSuffix: '', onChanged }));
    await act(async () => byTestId('staff-access-st2').props.onPress());
    await act(async () => (alert.mock.calls[0][2] as { onPress?: () => void }[]).find((b) => b.onPress)!.onPress!());
    expect(text()).toContain('This barber is serving a customer right now.');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('never offers to remove the owner\'s own access', async () => {
    await mount(createElement(StaffMemberRow, { salonId: 's1', member: member({ roleInSalon: 'OWNER' }), invitePendingSuffix: '', onChanged: jest.fn() }));
    expect(byTestId('staff-access-st2')).toBeUndefined();
  });
});

describe('customer: invoices and calling the shop', () => {
  it('lists only what the server returns for this account and opens one invoice', async () => {
    (apiFetch as jest.Mock).mockImplementation(async (path: string) => {
      if (path === 'invoices/mine') return { items: [{ id: 'i1', number: 'S360-000009', salonId: 's1', sourceType: 'BOOKING', bookingId: 'b1', queueEntryId: null, customerName: 'Me', currency: 'INR', total: 250, amountPaid: 250, amountRefunded: 0, balanceDue: 0, paymentStatus: 'PAID', status: 'ISSUED', issuedAt: '2026-10-12T10:00:00.000Z', serviceDate: '2026-10-12' }], nextCursor: null };
      if (path === 'invoices/mine/i1') return { id: 'i1', total: 250, amountPaid: 250, taxLabel: null, taxTotal: 0, seller: { legalName: 'Studio 360 Barbers', gstin: null }, lines: [{ id: 'l1', description: 'Haircut', quantity: 1, lineTotal: 250 }] };
      return {};
    });
    await mount(createElement(MyInvoicesScreen));
    expect(text()).toContain('S360-000009');
    expect(text()).toContain('Paid');
    await act(async () => byTestId('my-invoice-S360-000009').props.onPress());
    await act(async () => Promise.resolve());
    expect(text()).toContain('Studio 360 Barbers');
    expect(text()).toContain('Paid to the shop');
  });

  it('says plainly when there are no invoices', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
    await mount(createElement(MyInvoicesScreen));
    expect(text()).toContain('No invoices yet');
  });
});
