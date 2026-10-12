/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Linking } from 'react-native';
import { ShopBookingActionsNative } from '../ShopBookingActionsNative';
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
jest.mock('../../ui', () => {
  const { Text } = require('react-native');
  const { createElement: h } = require('react');
  return {
    Button: require('../../ui/Button').Button,
    InlineError: ({ message }: { message: string }) => h(Text, { testID: 'inline-error' }, message),
  };
});

const booking = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'b1',
    salonId: 's1',
    status: 'CONFIRMED',
    source: 'APP',
    serviceName: 'Haircut',
    slotStart: '2026-10-14T10:00:00.000Z',
    customerPhone: '+919811122233',
    guestPhone: null,
    cancelledByActor: null,
    cancellationReason: null,
    services: [{ serviceId: 'sv1', name: 'Haircut', durationMinutes: 30, price: 250 }],
    assignedStaffId: null,
    preferredStaffId: null,
    ...overrides,
  }) as never;

let tree: ReturnType<typeof TestRenderer.create> | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = { props: Record<string, any>; findAll: (p: (n: Node) => boolean) => Node[] };
const nodes = (p: (n: Node) => boolean) => (tree!.root as unknown as Node).findAll(p);
const button = (title: string) => nodes((n) => n.props?.title === title && typeof n.props?.onPress === 'function')[0];
const byTestId = (id: string) => nodes((n) => n.props?.testID === id)[0];
const text = () => JSON.stringify(tree!.toJSON());
const press = async (title: string) => {
  const b = button(title);
  if (!b) throw new Error(`no button "${title}"`);
  await act(async () => {
    await b.props.onPress();
  });
};

async function render(b = booking(), extra: Record<string, unknown> = {}) {
  const onChanged = jest.fn();
  const onReschedule = jest.fn();
  await act(async () => {
    tree = TestRenderer.create(createElement(ShopBookingActionsNative, { booking: b, onChanged, onReschedule, ...extra }));
  });
  return { onChanged, onReschedule };
}

beforeEach(() => {
  jest.clearAllMocks();
  (apiFetch as jest.Mock).mockImplementation(async (path: string) => {
    if (path.endsWith('/cancel')) return { bookingId: 'b1', status: 'CANCELLED', cancelledByActor: 'OWNER', cancelledAt: 'x', notification: { inApp: 'SENT', push: 'NO_DEVICE' } };
    if (path.endsWith('/invoices')) return { id: 'inv1', number: 'S360-000002' };
    return {};
  });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

describe('shop booking actions', () => {
  it('cancels with a reason, as the shop, and says truthfully what the customer was told', async () => {
    const { onChanged } = await render();
    await press('Cancel appointment');
    await act(async () => byTestId('cancel-reason').props.onChangeText('Barber unwell'));
    await press('Cancel appointment and notify');
    const call = (apiFetch as jest.Mock).mock.calls.find(([path]) => path.endsWith('/cancel'));
    expect(call[0]).toBe('dashboard/salons/s1/bookings/b1/cancel');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['Idempotency-Key']).toBe('idem-key');
    expect(JSON.parse(call[1].body)).toEqual({ reason: 'Barber unwell' });
    expect(text()).toContain('notified in the app');
    expect(text()).toContain('no device registered for push');
    expect(text()).not.toMatch(/sms/i);
    expect(onChanged).toHaveBeenCalled();
  });

  it('can keep the appointment instead, sending nothing', async () => {
    await render();
    await press('Cancel appointment');
    await press('Keep appointment');
    expect((apiFetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(button('Cancel appointment')).toBeDefined();
  });

  it('shows the server\'s message and sends nothing more when cancelling fails', async () => {
    const { ApiError } = require('../../../lib/api');
    (apiFetch as jest.Mock).mockRejectedValueOnce(new ApiError(409, { error: { code: 'X', message: 'This appointment can no longer be cancelled.' } }));
    const { onChanged } = await render();
    await press('Cancel appointment');
    await press('Cancel appointment and notify');
    expect(text()).toContain('This appointment can no longer be cancelled.');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('offers reschedule and call only where they make sense', async () => {
    const { onReschedule } = await render();
    await press('Reschedule');
    expect(onReschedule).toHaveBeenCalledTimes(1);
    await press('Call customer');
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+919811122233');
  });

  it('offers neither cancel nor reschedule once the service is done, but offers the invoice - once', async () => {
    const opened: string[] = [];
    await render(booking({ status: 'COMPLETED' }), { onOpenInvoice: (id: string) => opened.push(id) });
    expect(button('Cancel appointment')).toBeUndefined();
    expect(button('Reschedule')).toBeUndefined();
    await press('Create invoice');
    const created = (apiFetch as jest.Mock).mock.calls.find(([path]) => path.endsWith('/invoices'));
    expect(JSON.parse(created[1].body)).toEqual({ bookingId: 'b1' });
    await press('View invoice S360-000002');
    expect(opened).toEqual(['inv1']);
  });

  it('shows who cancelled and why, and never guesses for an older booking', async () => {
    await render(booking({ status: 'CANCELLED', cancelledByActor: 'OWNER', cancellationReason: 'Power cut' }));
    expect(text()).toContain('Cancelled by owner');
    expect(text()).toContain('Power cut');
    await act(async () => tree!.unmount());
    tree = undefined;
    await render(booking({ status: 'CANCELLED', cancelledByActor: null }));
    expect(text()).toContain('not recorded (older booking)');
  });

  it('calls an in-shop guest on the number the shop saved with their consent', async () => {
    await render(booking({ customerPhone: null, guestPhone: '+919900011122', source: 'IN_SHOP' }));
    await press('Call customer');
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+919900011122');
  });
});
