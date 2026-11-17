/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Alert } from 'react-native';
import { AddOnServicesRow, visitServiceLabel } from '../AddOnServicesRow';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => 'idem-key' }));
jest.mock('../../../lib/language-context', () => ({
  useLanguage: () => ({ language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') }),
}));
jest.mock('../../ui', () => {
  const { Text } = require('react-native');
  const { createElement: h } = require('react');
  return {
    Button: require('../../ui/Button').Button,
    InlineError: ({ message }: { message: string }) => h(Text, { testID: 'inline-error' }, message),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Inst = any;

const services = [
  { id: 'sv1', name: 'Haircut', durationMinutes: 30, price: 250 },
  { id: 'sv2', name: 'Beard Trim', durationMinutes: 15, price: 150 },
  { id: 'sv3', name: 'Head Massage', durationMinutes: 20, price: 200 },
];

function entry(over: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    salonId: 's1',
    bookingId: null,
    source: 'WALK_IN',
    tokenNumber: 4,
    status: 'IN_SERVICE',
    serviceId: 'sv1',
    serviceName: 'Haircut',
    addOns: [],
    addOnMinutes: 0,
    ...over,
  } as never;
}

function byLabel(root: Inst, label: string) {
  return root.find((n: Inst) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
}

function byTitle(root: Inst, title: string) {
  return root.find((n: Inst) => n.props.title === title && typeof n.props.onPress === 'function');
}

function texts(root: Inst): string {
  return root
    .findAll((n: Inst) => typeof n.props.children === 'string' || Array.isArray(n.props.children))
    .map((n: Inst) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
    .join(' | ');
}

describe('AddOnServicesRow (Android and iOS)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('offers only services that are not already part of the visit, then adds the chosen one', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({});
    const onChanged = jest.fn();
    let r!: { root: Inst };
    await act(async () => {
      r = TestRenderer.create(
        createElement(AddOnServicesRow, {
          entry: entry({ addOns: [{ serviceId: 'sv3', name: 'Head Massage', durationMinutes: 20, price: 200, addedAt: '2026-11-17T10:00:00Z' }] }),
          services,
          onChanged,
        }),
      );
    });
    await act(async () => byTitle(r.root, '+ Add service').props.onPress());
    // Haircut is the visit's own service and Head Massage is already added: only Beard Trim is offered.
    expect(() => byLabel(r.root, 'Add Haircut')).toThrow();
    expect(() => byLabel(r.root, 'Add Head Massage')).toThrow();
    await act(async () => byLabel(r.root, 'Add Beard Trim').props.onPress());
    expect(apiFetch).toHaveBeenCalledWith('dashboard/queue-entries/q1/add-ons', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'idem-key' },
      body: JSON.stringify({ serviceId: 'sv2' }),
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('asks before removing an add-on, then removes it', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({});
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const onChanged = jest.fn();
    let r!: { root: Inst };
    await act(async () => {
      r = TestRenderer.create(
        createElement(AddOnServicesRow, {
          entry: entry({ addOns: [{ serviceId: 'sv2', name: 'Beard Trim', durationMinutes: 15, price: 150, addedAt: '2026-11-17T10:00:00Z' }] }),
          services,
          onChanged,
        }),
      );
    });
    expect(texts(r.root)).toContain('+ Beard Trim · 15 min');
    await act(async () => byLabel(r.root, 'Remove Beard Trim').props.onPress());
    expect(alert).toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledWith('dashboard/queue-entries/q1/add-ons/sv2', { method: 'DELETE' });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows the server message when an add-on is refused', async () => {
    const { ApiError } = jest.requireMock('../../../lib/api') as { ApiError: new (s: number, m: string) => Error };
    (apiFetch as jest.Mock).mockRejectedValueOnce(new ApiError(409, 'This service is already part of this visit.'));
    const onChanged = jest.fn();
    let r!: { root: Inst };
    await act(async () => {
      r = TestRenderer.create(createElement(AddOnServicesRow, { entry: entry(), services, onChanged }));
    });
    await act(async () => byTitle(r.root, '+ Add service').props.onPress());
    await act(async () => byLabel(r.root, 'Add Beard Trim').props.onPress());
    expect(r.root.findByProps({ testID: 'inline-error' }).props.children).toBe('This service is already part of this visit.');
    // A conflict means the list is stale: refresh it.
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('names the whole visit: its own service plus everything added at the shop', () => {
    expect(visitServiceLabel(entry())).toBe('Haircut');
    expect(
      visitServiceLabel(entry({ addOns: [{ serviceId: 'sv2', name: 'Beard Trim', durationMinutes: 15, price: 150, addedAt: '' }] })),
    ).toBe('Haircut + Beard Trim');
    expect(visitServiceLabel(entry({ serviceName: null }))).toBeNull();
  });
});
