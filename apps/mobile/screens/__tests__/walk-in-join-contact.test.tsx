/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { TextInput } from 'react-native';
import { uiStringsFor } from '@barbercue/shared';
import WalkInJoinScreen from '../WalkInJoinScreen';
import { apiFetch } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('../../lib/idempotency', () => ({ newIdempotencyKey: () => 'idem-key' }));
const mockAuth = { status: 'authenticated', user: { phone: null as string | null } };
jest.mock('../../lib/auth-context', () => ({ useAuth: () => mockAuth }));
jest.mock('../../lib/language-context', () => ({
  useLanguage: () => ({ language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') }),
}));
jest.mock('../../lib/guest-booking-handoff', () => ({ stashPendingGuestIntent: jest.fn() }));
jest.mock('../../components/auth/GoogleSignInGate', () => ({ GoogleSignInGate: () => null }));
jest.mock('../../components/QueueStatusPanel', () => ({ QueueStatusPanel: () => null }));
jest.mock('../../components/ui', () => {
  const { View, Text } = require('react-native');
  const { createElement: h } = require('react');
  return {
    Screen: View,
    SectionHeader: () => null,
    Skeleton: View,
    Button: require('../../components/ui/Button').Button,
    InlineError: ({ message }: { message: string }) => h(Text, { testID: 'error' }, message),
  };
});

const t = uiStringsFor('EN');
const props = {
  route: { params: { salonId: 's1', services: [{ id: 'sv1', name: 'Beard', durationMinutes: 20 }] } },
} as never;

let tree: ReturnType<typeof TestRenderer.create> | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = { props: Record<string, any>; children?: unknown[]; parent: Node | null };
const inputs = () => (tree!.root as unknown as { findAllByType: (t: unknown) => Node[] }).findAllByType(TextInput);
const joinButton = () =>
  (tree!.root as unknown as { findAll: (p: (n: Node) => boolean) => Node[] }).findAll(
    (n) => n.props?.title === t.joinQueue && typeof n.props?.onPress === 'function',
  )[0];
const screenText = () => JSON.stringify(tree!.toJSON());
const type = async (index: number, value: string) => {
  await act(async () => inputs()[index].props.onChangeText(value));
};
const join = async () => {
  await act(async () => {
    await joinButton().props.onPress();
  });
};
const postBody = () => {
  const call = (apiFetch as jest.Mock).mock.calls.find(([, init]) => init?.method === 'POST');
  return call ? JSON.parse(call[1].body) : null;
};

async function render() {
  await act(async () => {
    tree = TestRenderer.create(createElement(WalkInJoinScreen, props));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.status = 'authenticated';
  mockAuth.user = { phone: null };
  (apiFetch as jest.Mock).mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return { id: 'q1', salonId: 's1', tokenNumber: 1 };
    return null; // GET queue-entries/mine/active -> no active entry
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
});

it('collects a name and a mobile number before joining', async () => {
  await render();
  expect(inputs()).toHaveLength(2);
  expect(screenText()).toContain(t.contactNameLabel);
  expect(screenText()).toContain(t.contactPhoneLabel);
});

it('does not join without a name - and sends nothing', async () => {
  await render();
  await type(1, '9811122233');
  await join();
  expect(screenText()).toContain(t.contactNameRequiredError);
  expect(postBody()).toBeNull();
});

it('does not join with an invalid mobile number - and sends nothing (never an uncontactable entry)', async () => {
  await render();
  await type(0, 'Ravi Kumar');
  await type(1, '12345');
  await join();
  expect(screenText()).toContain(t.contactPhoneInvalidError);
  expect(postBody()).toBeNull();
});

it('joins with the normalized name and E.164 phone', async () => {
  await render();
  await type(0, '  Ravi   Kumar ');
  await type(1, '98111 22233');
  await join();
  expect(postBody()).toEqual({ contactName: 'Ravi Kumar', contactPhone: '+919811122233' });
});

it('prefills the phone from the account when it has one, so the customer only types a name', async () => {
  mockAuth.user = { phone: '+919000000001' };
  await render();
  expect(inputs()[1].props.value).toBe('+919000000001');
  await type(0, 'Ravi');
  await join();
  expect(postBody()).toEqual({ contactName: 'Ravi', contactPhone: '+919000000001' });
});

it('keeps the optional service selection alongside the contact details', async () => {
  await render();
  // Find the "Beard" label, then walk up to the pressable row that owns the onPress handler.
  const label = (tree!.root as unknown as { findAll: (p: (n: Node) => boolean) => Node[] }).findAll(
    (n) => Array.isArray(n.children) && n.children[0] === 'Beard',
  )[0];
  let option: Node | null = label;
  while (option && typeof option.props?.onPress !== 'function') option = option.parent;
  await act(async () => option!.props.onPress());
  await type(0, 'Ravi');
  await type(1, '9811122233');
  await join();
  expect(postBody()).toEqual({ serviceId: 'sv1', contactName: 'Ravi', contactPhone: '+919811122233' });
});

it('shows no contact fields to a guest (they appear after sign-in)', async () => {
  mockAuth.status = 'unauthenticated';
  await render();
  expect(inputs()).toHaveLength(0);
});
