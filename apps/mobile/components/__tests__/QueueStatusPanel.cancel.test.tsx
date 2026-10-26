/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Alert } from 'react-native';
import { QueueStatusPanel } from '../QueueStatusPanel';
import { uiStringsFor } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';

jest.mock('../../lib/api', () => ({
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
jest.mock('../../lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
let mockLanguage = 'EN';
jest.mock('../../lib/language-context', () => ({
  useLanguage: () => ({ language: mockLanguage, t: require('@barbercue/shared').uiStringsFor(mockLanguage) }),
}));
jest.mock('../../lib/realtime', () => ({
  getRealtimeSocket: () => ({ on: jest.fn(), off: jest.fn() }),
  joinSalonRoom: jest.fn(),
  onReconnect: () => () => undefined,
}));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));

type Rendered = ReturnType<typeof TestRenderer.create>;
type TestNode = { props?: Record<string, unknown> };
const mockedApi = apiFetch as jest.Mock;

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
  } as never;
}

async function render(e: never, onEntryChange = jest.fn()) {
  let renderer!: Rendered;
  await act(async () => {
    renderer = TestRenderer.create(createElement(QueueStatusPanel, { entry: e, onEntryChange }));
  });
  return { renderer, onEntryChange };
}

const cancelButtons = (r: Rendered) => r.root.findAll((n: TestNode) => n.props?.accessibilityLabel === 'Cancel Live Queue token' && typeof n.props?.onPress === 'function');
const alertTexts = (r: Rendered) => r.root.findAll((n: TestNode) => n.props?.accessibilityRole === 'alert').map((n: TestNode) => String(n.props?.children));
const confirmButtons = (spy: jest.SpyInstance) => spy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;

describe('mobile QueueStatusPanel - customer cancellation', () => {
  let alertSpy: jest.SpyInstance;
  beforeEach(() => {
    mockLanguage = 'EN';
    mockedApi.mockReset();
    mockedApi.mockResolvedValue(null);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => alertSpy.mockRestore());

  it.each(['WAITING', 'CALLED'])('offers Cancel Live Queue for a standalone %s token', async (status) => {
    const { renderer } = await render(entry({ status }));
    expect(cancelButtons(renderer).length).toBeGreaterThan(0);
  });

  it.each(['IN_SERVICE', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])('does not offer cancellation for a %s token', async (status) => {
    const { renderer } = await render(entry({ status }));
    expect(cancelButtons(renderer)).toHaveLength(0);
  });

  it('does not offer it for an appointment check-in (booking-linked)', async () => {
    const { renderer } = await render(entry({ bookingId: 'b1', source: 'APPOINTMENT' }));
    expect(cancelButtons(renderer)).toHaveLength(0);
  });

  it('asks for confirmation first; "Keep my place" sends nothing', async () => {
    const { renderer, onEntryChange } = await render(entry());
    await act(async () => {
      cancelButtons(renderer)[0].props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const buttons = confirmButtons(alertSpy);
    expect(buttons.map((b) => b.text)).toEqual(['Keep my place', 'Cancel queue']);
    expect(mockedApi.mock.calls.filter((c) => String(c[0]).endsWith('/cancel'))).toHaveLength(0);
    expect(onEntryChange).not.toHaveBeenCalled();
  });

  it('confirming POSTs once, is not optimistic, ignores a second tap in flight, then clears from the server response', async () => {
    let resolveCancel!: (v: unknown) => void;
    mockedApi.mockImplementation((path: string) =>
      path.endsWith('/cancel') ? new Promise((resolve) => { resolveCancel = resolve; }) : Promise.resolve(null),
    );
    const { renderer, onEntryChange } = await render(entry());
    await act(async () => {
      cancelButtons(renderer)[0].props.onPress();
    });
    await act(async () => {
      confirmButtons(alertSpy)[1].onPress?.();
    });
    const calls = () => mockedApi.mock.calls.filter((c) => String(c[0]).endsWith('/cancel'));
    expect(calls()).toHaveLength(1);
    expect(String(calls()[0][0])).toMatch(/queue-entries\/q1\/cancel$/);
    expect(calls()[0][1]).toEqual({ method: 'POST' });
    expect(onEntryChange).not.toHaveBeenCalled();
    // A second tap while in flight must not open another dialog or send another request.
    await act(async () => {
      cancelButtons(renderer)[0]?.props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(calls()).toHaveLength(1);
    await act(async () => {
      resolveCancel({ id: 'q1', status: 'CANCELLED' });
    });
    expect(onEntryChange).toHaveBeenCalledWith(null);
  });

  it('shows the server error and re-reads the real ticket when the shop already started the service', async () => {
    const started = entry({ status: 'IN_SERVICE' });
    mockedApi.mockImplementation((path: string) =>
      String(path).endsWith('/cancel')
        ? Promise.reject(new (ApiError as never as new (s: number, b: unknown) => Error)(409, { error: { code: 'INVALID_QUEUE_TRANSITION', message: 'Your Live Queue status changed. Refresh and try again.' } }))
        : Promise.resolve(started),
    );
    const { renderer, onEntryChange } = await render(entry());
    await act(async () => {
      cancelButtons(renderer)[0].props.onPress();
    });
    await act(async () => {
      confirmButtons(alertSpy)[1].onPress?.();
    });
    expect(alertTexts(renderer)).toContain('Your Live Queue status changed. Refresh and try again.');
    expect(onEntryChange).toHaveBeenCalledWith(started);
    expect(onEntryChange).not.toHaveBeenCalledWith(null);
  });

  it('shows a generic message on a network failure and keeps the ticket', async () => {
    mockedApi.mockRejectedValue(new Error('network'));
    const { renderer, onEntryChange } = await render(entry());
    await act(async () => {
      cancelButtons(renderer)[0].props.onPress();
    });
    await act(async () => {
      confirmButtons(alertSpy)[1].onPress?.();
    });
    expect(alertTexts(renderer)).toContain('Could not cancel your Live Queue token. Please try again.');
    expect(onEntryChange).not.toHaveBeenCalled();
  });

  it('is fully localized: in Hindi the button, the dialog and the generic error are Hindi', async () => {
    mockLanguage = 'HI';
    const hi = uiStringsFor('HI' as never);
    const en = uiStringsFor('EN' as never);
    expect(hi.cancelLiveQueueAction).not.toBe(en.cancelLiveQueueAction);
    mockedApi.mockRejectedValue(new Error('network'));
    const { renderer } = await render(entry());
    const buttons = renderer.root.findAll((n: TestNode) => n.props?.accessibilityLabel === hi.cancelLiveQueueA11yLabel && typeof n.props?.onPress === 'function');
    expect(buttons.length).toBeGreaterThan(0);
    await act(async () => {
      buttons[0].props.onPress();
    });
    expect(alertSpy.mock.calls[0][0]).toBe(hi.cancelLiveQueueConfirmTitle);
    expect(alertSpy.mock.calls[0][1]).toBe(hi.cancelLiveQueueConfirmMessage);
    expect((alertSpy.mock.calls[0][2] as Array<{ text: string }>).map((b) => b.text)).toEqual([hi.keepMyPlaceAction, hi.confirmCancelLiveQueueAction]);
    await act(async () => {
      (alertSpy.mock.calls[0][2] as Array<{ onPress?: () => void }>)[1].onPress?.();
    });
    expect(alertTexts(renderer)).toContain(hi.couldNotCancelLiveQueue);
  });
});
