/// <reference types="jest" />

// Owner registration must start with email + password, never with Google: this drives the real
// screens a new owner passes through (the owner sign-in screen and the account-creation screen).
jest.setTimeout(30_000);

import { createElement } from 'react';
import { uiStringsFor } from '@barbercue/shared';
import { allText, byTestId, flush, has, press, render, type as typeText } from '../../lib/location/__fixtures__/render';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

jest.mock('../../lib/language-context', () => {
  const { uiStringsFor: strings } = require('@barbercue/shared');
  return { useLanguage: () => ({ language: 'EN', setLanguage: jest.fn(), t: strings('EN') }) };
});

const mockOwnerSignup = jest.fn();
jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({
    ownerSignup: mockOwnerSignup,
    staffLogin: jest.fn(),
    staffGoogleLogin: jest.fn(),
  }),
}));

jest.mock('../../lib/api', () => {
  class MockApiError extends Error {}
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

const mockGoogle = jest.fn();
jest.mock('../../lib/google-signin', () => ({
  getGoogleIdToken: (...args: unknown[]) => mockGoogle(...args),
  GOOGLE_SIGNIN_CONFIGURED: true,
}));

const mockMarkPending = jest.fn().mockResolvedValue(undefined);
jest.mock('../../lib/shop-registration-resume', () => ({
  markShopRegistrationPending: () => mockMarkPending(),
  clearShopRegistrationPending: jest.fn().mockResolvedValue(undefined),
  isShopRegistrationPending: jest.fn().mockResolvedValue(false),
}));

import OwnerRegisterScreen from '../OwnerRegisterScreen';
import OwnerStaffLoginScreen from '../OwnerStaffLoginScreen';
import { takePendingCustomerDestination } from '../../lib/customer-navigation-intent';

const t = uiStringsFor('EN');

function navigationStub() {
  return { navigate: jest.fn(), replace: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  takePendingCustomerDestination(); // drain any stash from a previous test
});

describe('Owner sign-in screen (Shop Owner menu entry)', () => {
  it('offers email/password account creation FIRST, above the Google sign-in option', async () => {
    const navigation = navigationStub();
    const r = await render(createElement(OwnerStaffLoginScreen as never, { navigation, route: { params: { role: 'OWNER' } } } as never));
    await flush();
    expect(has(r, 'owner-create-account')).toBe(true);
    const text = allText(r);
    expect(text.indexOf(t.newToFastQueRegisterShop)).toBeLessThan(text.indexOf(t.continueWithGoogle));
    expect(text).toContain(t.ownerCreateAccountHint);
  });

  it('tapping it opens the email/password registration route and starts no Google flow', async () => {
    const navigation = navigationStub();
    const r = await render(createElement(OwnerStaffLoginScreen as never, { navigation, route: { params: { role: 'OWNER' } } } as never));
    await flush();
    await press(r, 'owner-create-account');
    expect(navigation.navigate).toHaveBeenCalledWith('OwnerRegister');
    expect(mockGoogle).not.toHaveBeenCalled();
    // The destination after signup is remembered so the new owner lands on Register Shop.
    expect(takePendingCustomerDestination()).toEqual({ kind: 'registerShop' });
  });

  it('does not show the owner-registration card on the staff sign-in', async () => {
    const navigation = navigationStub();
    const r = await render(createElement(OwnerStaffLoginScreen as never, { navigation, route: { params: { role: 'STAFF' } } } as never));
    await flush();
    expect(has(r, 'owner-create-account')).toBe(false);
  });
});

describe('Owner account creation screen', () => {
  const mountRegister = async () => {
    const navigation = navigationStub();
    const r = await render(createElement(OwnerRegisterScreen as never, { navigation, route: { params: undefined } } as never));
    await flush();
    return { r, navigation };
  };
  const inputs = (r: Awaited<ReturnType<typeof render>>) =>
    r.root.findAll((n: { type: unknown; props: Record<string, unknown> }) => n.type === 'TextInput' || (typeof n.props.onChangeText === 'function' && typeof n.type !== 'string'));
  const buttonByTitle = (r: Awaited<ReturnType<typeof render>>, title: string) =>
    r.root.findAll((n: { props: Record<string, unknown> }) => n.props.title === title && typeof n.props.onPress === 'function')[0];

  async function fill(r: Awaited<ReturnType<typeof render>>, email: string, password: string, confirm: string) {
    const fields = inputs(r).filter((n: { props: Record<string, unknown> }) => typeof n.props.onChangeText === 'function');
    // Order on screen: email, password, re-enter password.
    const unique = fields.filter((n: { props: Record<string, unknown> }, i: number, all: Array<{ props: Record<string, unknown> }>) => all.findIndex((m) => m.props.onChangeText === n.props.onChangeText) === i);
    const { act } = require('react');
    await act(async () => (unique[0].props.onChangeText as (v: string) => void)(email));
    await act(async () => (unique[1].props.onChangeText as (v: string) => void)(password));
    await act(async () => (unique[2].props.onChangeText as (v: string) => void)(confirm));
  }

  it('has no Google option at all', async () => {
    const { r } = await mountRegister();
    expect(allText(r)).not.toMatch(/google/i);
  });

  it('rejects mismatched passwords locally and creates nothing', async () => {
    const { r } = await mountRegister();
    await fill(r, 'owner@example.com', 'correct-horse-9', 'different-pass-1');
    const { act } = require('react');
    await act(async () => (buttonByTitle(r, 'Create account & continue').props.onPress as () => void)());
    await flush();
    expect(mockOwnerSignup).not.toHaveBeenCalled();
    expect(mockMarkPending).not.toHaveBeenCalled();
    expect(takePendingCustomerDestination()).toBeNull();
  });

  it('rejects a malformed email locally', async () => {
    const { r } = await mountRegister();
    await fill(r, 'not-an-email', 'correct-horse-9', 'correct-horse-9');
    const { act } = require('react');
    await act(async () => (buttonByTitle(r, 'Create account & continue').props.onPress as () => void)());
    await flush();
    expect(mockOwnerSignup).not.toHaveBeenCalled();
  });

  it('creates the account through the real owner-signup call, remembers the destination and the resume marker', async () => {
    mockOwnerSignup.mockResolvedValue({ id: 'u1' });
    const { r } = await mountRegister();
    await fill(r, 'owner@example.com', 'correct-horse-9', 'correct-horse-9');
    const { act } = require('react');
    await act(async () => (buttonByTitle(r, 'Create account & continue').props.onPress as () => void)());
    await flush();
    expect(mockOwnerSignup).toHaveBeenCalledTimes(1);
    expect(mockOwnerSignup.mock.calls[0][0]).toMatchObject({ email: 'owner@example.com', password: 'correct-horse-9', confirmPassword: 'correct-horse-9' });
    expect(mockMarkPending).toHaveBeenCalledTimes(1);
    expect(takePendingCustomerDestination()).toEqual({ kind: 'registerShop' });
    expect(mockGoogle).not.toHaveBeenCalled();
  });

  it('shows the backend message when signup is refused, and does not mark registration as pending', async () => {
    const { ApiError } = jest.requireMock('../../lib/api');
    mockOwnerSignup.mockRejectedValue(new ApiError('An account with this email already exists.'));
    const { r } = await mountRegister();
    await fill(r, 'owner@example.com', 'correct-horse-9', 'correct-horse-9');
    const { act } = require('react');
    await act(async () => (buttonByTitle(r, 'Create account & continue').props.onPress as () => void)());
    await flush();
    expect(allText(r)).toContain('An account with this email already exists.');
    expect(mockMarkPending).not.toHaveBeenCalled();
  });

  it('offers a way back to owner sign-in for existing owners', async () => {
    const { r, navigation } = await mountRegister();
    await press(r, 'owner-signin-link');
    expect(navigation.replace).toHaveBeenCalledWith('OwnerStaffLogin', { role: 'OWNER' });
  });
});

describe('screen helpers sanity', () => {
  it('find helpers resolve testIDs (guards the fixtures used above)', async () => {
    const navigation = navigationStub();
    const r = await render(createElement(OwnerStaffLoginScreen as never, { navigation, route: { params: { role: 'OWNER' } } } as never));
    await flush();
    expect(byTestId(r, 'owner-create-account').length).toBeGreaterThan(0);
    await typeText; // keep the import used for future text-entry tests
  });
});
