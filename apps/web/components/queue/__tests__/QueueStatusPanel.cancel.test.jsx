import { createElement as h, act } from 'react';
import TestRenderer from 'react-test-renderer';
import { QueueStatusPanel } from '../QueueStatusPanel';
import { apiFetch, ApiError } from '../../../lib/api';

jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    constructor(status, body) {
      super(body.error?.message ?? 'Request failed');
      this.status = status;
      this.code = body.error?.code ?? 'UNKNOWN_ERROR';
    }
  }
  return { apiFetch: jest.fn(), ApiError };
});
jest.mock('../../../lib/realtime', () => ({
  getRealtimeSocket: () => ({ on: jest.fn(), off: jest.fn() }),
  joinSalonRoom: jest.fn(),
  onReconnect: () => () => undefined,
}));

function entry(overrides = {}) {
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
    serviceName: 'Haircut',
    position: 2,
    customerPhone: '+919811122233',
    customerName: 'Ravi',
    arrivedAt: null,
    assignedStaffName: null,
    assignedChairLabel: null,
    activeServiceSessionId: null,
    joinedAt: '2026-10-23T10:00:00.000Z',
    calledAt: null,
    estimatedWaitRangeMinutes: null,
    turnApproaching: false,
    ...overrides,
  };
}

async function render(e, onEntryChange = jest.fn()) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(h(QueueStatusPanel, { entry: e, onEntryChange }));
  });
  return { renderer, onEntryChange };
}

const cancelButton = (renderer) => renderer.root.findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Cancel Live Queue token');
const alerts = (renderer) => renderer.root.findAll((n) => n.type === 'p' && n.props.role === 'alert');

describe('QueueStatusPanel - customer cancellation', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue(null);
    global.window = global.window || {};
    global.window.confirm = jest.fn(() => true);
  });

  it.each([
    ['WAITING', 'WAITING'],
    ['CALLED (assigned, not started)', 'CALLED'],
  ])('offers Cancel Live Queue for a standalone %s token', async (_label, status) => {
    const { renderer } = await render(entry({ status }));
    expect(cancelButton(renderer)).toHaveLength(1);
  });

  it.each(['IN_SERVICE', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])('does not offer cancellation for a %s token', async (status) => {
    const { renderer } = await render(entry({ status }));
    expect(cancelButton(renderer)).toHaveLength(0);
  });

  it('does not offer it for an appointment check-in (booking-linked)', async () => {
    const { renderer } = await render(entry({ bookingId: 'b1', source: 'APPOINTMENT' }));
    expect(cancelButton(renderer)).toHaveLength(0);
  });

  it('asks for confirmation and sends nothing when the customer keeps their place', async () => {
    global.window.confirm.mockReturnValue(false);
    const { renderer, onEntryChange } = await render(entry());
    await act(async () => {
      cancelButton(renderer)[0].props.onClick();
    });
    expect(global.window.confirm).toHaveBeenCalledTimes(1);
    expect(apiFetch).not.toHaveBeenCalledWith('queue-entries/q1/cancel', expect.anything());
    expect(onEntryChange).not.toHaveBeenCalled();
  });

  it('POSTs to the cancel route once confirmed and clears the ticket only from the server response', async () => {
    let resolveCancel;
    apiFetch.mockImplementation((path) =>
      path.endsWith('/cancel') ? new Promise((resolve) => { resolveCancel = resolve; }) : Promise.resolve(null),
    );
    const { renderer, onEntryChange } = await render(entry());
    await act(async () => {
      cancelButton(renderer)[0].props.onClick();
    });
    const cancelCalls = apiFetch.mock.calls.filter((c) => String(c[0]).endsWith('/cancel'));
    expect(cancelCalls).toHaveLength(1);
    expect(cancelCalls[0][0]).toMatch(/queue-entries\/q1\/cancel$/);
    expect(cancelCalls[0][1]).toEqual({ method: 'POST' });
    // Not optimistic: nothing is cleared, and a second tap is ignored, while the request is in flight.
    expect(onEntryChange).not.toHaveBeenCalled();
    expect(cancelButton(renderer)[0].props.disabled).toBe(true);
    await act(async () => {
      cancelButton(renderer)[0].props.onClick();
    });
    expect(apiFetch.mock.calls.filter((c) => String(c[0]).endsWith('/cancel'))).toHaveLength(1);
    await act(async () => {
      resolveCancel({ id: 'q1', status: 'CANCELLED' });
    });
    expect(onEntryChange).toHaveBeenCalledWith(null);
  });

  it('shows the server error and re-reads the real ticket when the shop already started the service', async () => {
    const started = entry({ status: 'IN_SERVICE' });
    apiFetch.mockImplementation((path) => {
      if (String(path).endsWith('/cancel')) {
        return Promise.reject(new ApiError(409, { error: { code: 'INVALID_QUEUE_TRANSITION', message: 'Your Live Queue status changed. Refresh and try again.' } }));
      }
      return Promise.resolve(started);
    });
    const { renderer, onEntryChange } = await render(entry());
    await act(async () => {
      cancelButton(renderer)[0].props.onClick();
    });
    expect(alerts(renderer).map((n) => n.children.join(''))).toContain('Your Live Queue status changed. Refresh and try again.');
    expect(onEntryChange).toHaveBeenCalledWith(started);
    expect(onEntryChange).not.toHaveBeenCalledWith(null);
  });

  it('shows a generic message on a network failure and leaves the ticket in place', async () => {
    apiFetch.mockImplementation((path) => (String(path).endsWith('/cancel') ? Promise.reject(new Error('network')) : Promise.reject(new Error('network'))));
    const { renderer, onEntryChange } = await render(entry());
    await act(async () => {
      cancelButton(renderer)[0].props.onClick();
    });
    expect(alerts(renderer).map((n) => n.children.join(''))).toContain('Could not cancel your Live Queue token. Please try again.');
    expect(onEntryChange).not.toHaveBeenCalled();
    expect(cancelButton(renderer)[0].props.disabled).toBe(false); // can retry
  });
});
