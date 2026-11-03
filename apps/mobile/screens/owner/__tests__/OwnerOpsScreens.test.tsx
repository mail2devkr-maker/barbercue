/// <reference types="jest" />
import { act, createElement, type ReactElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Share } from 'react-native';
import { apiFetch } from '../../../lib/api';
import OwnerInvoiceDetailScreen from '../OwnerInvoiceDetailScreen';
import OwnerInShopAppointmentScreen from '../OwnerInShopAppointmentScreen';
import OwnerCancellationsScreen from '../OwnerCancellationsScreen';
import OwnerInvoicesScreen from '../OwnerInvoicesScreen';

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
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => ({ selectedSalonId: 's1', selectedSalon: { id: 's1', name: 'Studio' } }) }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  // Like the real hook, re-runs whenever the callback's identity changes (i.e. when its inputs change).
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: { invoiceId: 'inv1' } }),
}));
jest.mock('../../../components/ui', () => {
  const { View, Text, Pressable, TextInput } = require('react-native');
  const { createElement: h } = require('react');
  return {
    PremiumScreen: ({ children }: { children: unknown }) => h(View, null, children),
    PremiumCard: ({ children, testID }: { children: unknown; testID?: string }) => h(View, { testID }, children),
    PremiumSectionHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => h(View, null, h(Text, null, title), subtitle ? h(Text, null, subtitle) : null),
    PremiumButton: ({ title, onPress, testID, loading }: { title: string; onPress: () => void; testID?: string; loading?: boolean }) => h(Pressable, { title, onPress, testID, disabled: loading }, h(Text, null, title)),
    PremiumTextField: (props: Record<string, unknown>) => h(TextInput, props),
    InlineError: ({ message }: { message: string }) => h(Text, { testID: 'inline-error' }, message),
    Skeleton: View,
    EmptyState: ({ title, message }: { title: string; message?: string }) => h(View, null, h(Text, null, title), message ? h(Text, null, message) : null),
  };
});

const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv1',
  number: 'S360-000081',
  salonId: 's1',
  salonName: 'Studio 360',
  sourceType: 'QUEUE_ENTRY',
  bookingId: null,
  queueEntryId: 'q1',
  customerName: 'Ravi',
  customerPhone: null,
  staffName: 'Arjun',
  currency: 'INR',
  subtotal: 500,
  discountTotal: 0,
  taxTotal: 0,
  taxLabel: null,
  taxRatePercent: null,
  taxMode: null,
  total: 500,
  amountPaid: 200,
  amountRefunded: 0,
  balanceDue: 300,
  paymentStatus: 'PARTIALLY_PAID',
  status: 'ISSUED',
  issuedAt: '2026-10-12T10:00:00.000Z',
  serviceDate: '2026-10-12',
  seller: { legalName: 'Studio 360 Barbers', gstin: null, address: null, phone: null, email: null },
  lines: [{ id: 'l1', description: 'Haircut', quantity: 1, unitPrice: 500, discount: 0, lineTotal: 500 }],
  payments: [{ id: 'p1', kind: 'PAYMENT', method: 'CASH', amount: 200, reference: null, note: null, recordedAt: '2026-10-12T10:05:00.000Z' }],
  voidReason: null,
  ...overrides,
});

let tree: ReturnType<typeof TestRenderer.create> | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = { props: Record<string, any>; children?: unknown[]; findAll: (p: (n: Node) => boolean) => Node[] };
const nodes = (p: (n: Node) => boolean) => (tree!.root as unknown as Node).findAll(p);
const byTestId = (id: string) => nodes((n) => n.props?.testID === id)[0];
const button = (title: string) => nodes((n) => n.props?.title === title && typeof n.props?.onPress === 'function')[0];
const text = () => JSON.stringify(tree!.toJSON());
const writes = () => (apiFetch as jest.Mock).mock.calls.filter(([, init]) => init?.method && init.method !== 'GET').map(([path, init]) => ({ path, init }));
const tap = async (title: string) => {
  const b = button(title);
  if (!b) throw new Error(`no button "${title}"`);
  await act(async () => {
    await b.props.onPress();
  });
};
const type = async (testID: string, value: string) => act(async () => byTestId(testID).props.onChangeText(value));
async function render(component: () => ReactElement | null) {
  await act(async () => {
    tree = TestRenderer.create(createElement(component));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

describe('invoice detail', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return {};
      if (path === 'dashboard/salons/s1/invoices/inv1') return invoice();
      return {};
    });
  });

  it('shows the invoice, what was received and what is still due', async () => {
    await render(OwnerInvoiceDetailScreen);
    const screen = text();
    expect(screen).toContain('Invoice S360-000081');
    expect(screen).toContain('Partly paid');
    expect(screen).toContain('₹300');
    expect(screen).toContain('Payment · Cash');
  });

  it('records money the shop received as a PAYMENT, with an idempotency key, defaulting to the balance due', async () => {
    await render(OwnerInvoiceDetailScreen);
    await tap('Record payment');
    expect(byTestId('pay-amount').props.value).toBe('300');
    await act(async () => byTestId('pay-method-UPI').props.onPress());
    await tap('Record payment');
    const sent = writes().find((w) => w.path === 'dashboard/salons/s1/invoices/inv1/payments');
    expect(sent!.init.headers['Idempotency-Key']).toBe('idem-key');
    expect(JSON.parse(sent!.init.body)).toEqual({ kind: 'PAYMENT', method: 'UPI', amount: 300 });
  });

  it('refuses an amount that is not a positive rupee value before sending anything', async () => {
    await render(OwnerInvoiceDetailScreen);
    await tap('Record payment');
    await type('pay-amount', '-5');
    await tap('Record payment');
    expect(text()).toContain('Enter an amount greater than zero');
    expect(writes()).toHaveLength(0);
  });

  it('offers a refund only when the shop has actually received money, and a void with a reason', async () => {
    await render(OwnerInvoiceDetailScreen);
    expect(byTestId('invoice-record-refund')).toBeDefined();
    await act(async () => byTestId('invoice-void').props.onPress());
    await tap('Void invoice');
    expect(text()).toContain('Say why this invoice is being voided');
    await type('void-reason', 'Wrong customer');
    await tap('Void invoice');
    const sent = writes().find((w) => w.path === 'dashboard/salons/s1/invoices/inv1/void');
    expect(JSON.parse(sent!.init.body)).toEqual({ reason: 'Wrong customer' });
  });

  it('does not offer a payment on an unpaid-nothing invoice refund, and offers nothing at all once void', async () => {
    (apiFetch as jest.Mock).mockImplementation(async () => invoice({ status: 'VOID', paymentStatus: 'UNPAID', amountPaid: 0, balanceDue: 500, voidReason: 'Wrong customer', payments: [] }));
    await render(OwnerInvoiceDetailScreen);
    expect(button('Record payment')).toBeUndefined();
    expect(byTestId('invoice-void')).toBeUndefined();
    expect(text()).toContain('Voided: Wrong customer');
  });

  it('shares a plain-text summary rather than pretending to share a PDF file', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    await render(OwnerInvoiceDetailScreen);
    await tap('Share invoice summary');
    const message = (share.mock.calls[0][0] as { message: string }).message;
    expect(message).toContain('Invoice S360-000081');
    expect(message).toContain('Balance due: ₹300');
  });
});

describe('in-shop appointment', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith('/bookings/in-shop')) return { id: 'bk12345678', guestName: 'Meera', guestPhone: null, slotStart: '2026-10-14T10:00:00.000Z', serviceNames: ['Haircut'], staffName: null };
      if (path.includes('/services')) return [{ id: '11111111-1111-4111-8111-111111111111', name: 'Haircut', description: null, durationMinutes: 30, price: 250, category: null, isActive: true, currency: 'INR' }];
      if (path.includes('/timezone')) return { timezone: 'Asia/Kolkata' };
      if (path.includes('/booking/staff')) return [];
      if (path.includes('/booking/availability')) return [{ slotStart: '2026-10-14T10:00:00.000Z', slotEnd: '2026-10-14T10:30:00.000Z', available: true, state: 'AVAILABLE' }];
      if (init?.method === 'POST') return {};
      return {};
    });
  });

  it('does not send an appointment without a name, a service and a free time', async () => {
    await render(OwnerInShopAppointmentScreen);
    await tap('Create appointment');
    expect(writes()).toHaveLength(0);
    expect(text()).toMatch(/name|Choose a date/i);
  });

  it('refuses a saved phone number without the customer\'s consent', async () => {
    await render(OwnerInShopAppointmentScreen);
    await type('inshop-name', 'Meera Shah');
    await type('inshop-phone', '9876543210');
    await act(async () => byTestId('inshop-service-11111111-1111-4111-8111-111111111111').props.onPress());
    await act(async () => Promise.resolve());
    const slot = nodes((n) => typeof n.props?.testID === 'string' && n.props.testID.startsWith('slot-2'))[0];
    expect(slot).toBeDefined();
    await act(async () => slot.props.onPress());
    await tap('Create appointment');
    expect(writes().filter((w) => w.path.endsWith('/bookings/in-shop'))).toHaveLength(0);
    expect(text()).toContain('agreed to be contacted');
    // With consent the same appointment goes through.
    await act(async () => byTestId('inshop-consent').props.onChange(true));
    await tap('Create appointment');
    expect(JSON.parse(writes().find((w) => w.path.endsWith('/bookings/in-shop'))!.init.body)).toMatchObject({ guestPhone: expect.any(String), contactConsent: true });
  });

  it('creates a guest appointment through the real booking endpoint, with no FastQue account involved', async () => {
    await render(OwnerInShopAppointmentScreen);
    await type('inshop-name', 'Meera Shah');
    await act(async () => byTestId('inshop-service-11111111-1111-4111-8111-111111111111').props.onPress());
    await act(async () => Promise.resolve());
    const slot = nodes((n) => typeof n.props?.testID === 'string' && n.props.testID.startsWith('slot-2'))[0];
    expect(slot).toBeDefined();
    await act(async () => slot.props.onPress());
    await tap('Create appointment');
    const sent = writes().find((w) => w.path === 'dashboard/salons/s1/bookings/in-shop');
    expect(sent!.init.headers['Idempotency-Key']).toBe('idem-key');
    const body = JSON.parse(sent!.init.body);
    expect(body.guestName).toBe('Meera Shah');
    expect(body.serviceIds).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(body).not.toHaveProperty('customerId');
    expect(text()).toContain('Appointment created');
  });
});

describe('cancellations', () => {
  it('shows who cancelled from what was recorded, and "Not recorded" for older bookings', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({
      from: 'a',
      to: 'b',
      currency: 'INR',
      totalCancellations: 6,
      totalBookings: 11,
      cancellationRatePercent: 54.5,
      byActor: { CUSTOMER: 3, OWNER: 1, STAFF: 1, SYSTEM: 0, ADMIN: 0, UNKNOWN: 1 },
      byService: [{ key: 'a', label: 'Classic Haircut', count: 4 }],
      byReason: [{ key: 'none', label: 'No reason given', count: 4 }],
      charges: { charged: 0, waived: 0, outstanding: 0, settled: 0 },
      rows: [],
      liveQueue: { cancelled: 1, expired: 0, noShow: 1 },
      unattributedCount: 1,
    });
    await render(OwnerCancellationsScreen);
    expect((apiFetch as jest.Mock).mock.calls[0][0]).toBe('dashboard/salons/s1/analytics/cancellations?range=30d');
    const screen = text();
    expect(screen).toContain('54.5%');
    expect(screen).toContain('Not recorded');
    expect(screen).toContain('1 older cancellation has no record of who cancelled');
    expect(screen).toContain('Live Queue (separate)');
  });

  it('filters by who cancelled with a fresh request', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ totalCancellations: 0, totalBookings: 0, cancellationRatePercent: null, currency: 'INR', byActor: { CUSTOMER: 0, OWNER: 0, STAFF: 0, SYSTEM: 0, ADMIN: 0, UNKNOWN: 0 }, byService: [], byReason: [], charges: { charged: 0, waived: 0, outstanding: 0, settled: 0 }, rows: [], liveQueue: { cancelled: 0, expired: 0, noShow: 0 }, unattributedCount: 0 });
    await render(OwnerCancellationsScreen);
    await act(async () => byTestId('cancel-actor-OWNER').props.onPress());
    await act(async () => Promise.resolve());
    const paths = (apiFetch as jest.Mock).mock.calls.map(([p]) => p);
    expect(paths).toContain('dashboard/salons/s1/analytics/cancellations?range=30d&actor=OWNER');
  });
});

describe('invoice list', () => {
  it('lists real invoices, filters by payment state and opens the detail', async () => {
    (apiFetch as jest.Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('dashboard/salons/s1/invoices')) return { items: [invoice()], nextCursor: null };
      return {};
    });
    await render(OwnerInvoicesScreen);
    expect(text()).toContain('S360-000081');
    expect(text()).toContain('Partly paid');
    await act(async () => byTestId('invoice-filter-UNPAID').props.onPress());
    await act(async () => Promise.resolve());
    expect((apiFetch as jest.Mock).mock.calls.map(([p]) => p)).toContain('dashboard/salons/s1/invoices?payment=UNPAID');
    await act(async () => byTestId('invoice-S360-000081').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('OwnerInvoiceDetail', { invoiceId: 'inv1' });
  });
});
