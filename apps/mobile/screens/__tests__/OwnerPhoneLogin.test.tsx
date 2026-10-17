/// <reference types="jest" />

// Returning shop-owner phone sign-in (Issue #211): drives the real screen and the entry point on the owner sign-in
// screen with a mocked API. Never touches a network, a real backend or an SMS provider.
jest.setTimeout(30_000);

import { createElement } from 'react';
import { act } from 'react';
import { allText, advance, byTestId, flush, has, press, render, type as typeText } from '../../lib/location/__fixtures__/render';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

let mockLanguage = 'EN';
jest.mock('../../lib/language-context', () => {
  const { uiStringsFor: strings } = require('@barbercue/shared');
  return { useLanguage: () => ({ language: mockLanguage, setLanguage: jest.fn(), t: strings('EN') }) };
});

const mockApplySession = jest.fn();
jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ applySession: mockApplySession, staffLogin: jest.fn(), staffGoogleLogin: jest.fn(), ownerSignup: jest.fn() }),
}));

jest.mock('../../lib/api', () => {
  class MockApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, body: { error: { code: string; message: string } }) {
      super(body.error.message);
      this.status = status;
      this.code = body.error.code;
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

jest.mock('../../lib/google-signin', () => ({ getGoogleIdToken: jest.fn(), GOOGLE_SIGNIN_CONFIGURED: true }));

import { ApiError, apiFetch } from '../../lib/api';
import OwnerPhoneLoginScreen from '../OwnerPhoneLoginScreen';
import OwnerStaffLoginScreen from '../OwnerStaffLoginScreen';
import { ownerPhoneStrings } from '../../lib/owner-phone-otp-strings';

const mockFetch = apiFetch as jest.Mock;
const mounted: Array<{ unmount(): void }> = [];
afterEach(async () => {
  // Unmount so the screen's one-second resend timer never outlives its test.
  await act(async () => {
    mounted.splice(0).forEach((r) => r.unmount());
  });
});
const S = ownerPhoneStrings('EN');
const err = (status: number) => new (ApiError as unknown as new (s: number, b: unknown) => Error)(status, { error: { code: 'X', message: 'server text must not be shown' } });
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });

async function mountPhone() {
  const navigation = nav();
  const r = await render(createElement(OwnerPhoneLoginScreen as never, { navigation, route: { params: undefined } } as never));
  mounted.push(r);
  await flush();
  return { r, navigation };
}

async function sendCode(r: Awaited<ReturnType<typeof render>>, number = '98765 43210') {
  await typeText(r, 'owner-phone-number', number);
  await press(r, 'send-code');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = 'EN';
  mockFetch.mockImplementation(async (path: string) => {
    if (path === 'auth/methods') return { google: true, phoneOtp: true, ownerPhoneOtp: true };
    return {};
  });
});

// The "Send code" button comes from PremiumButton, which has no testID prop; find it by its title.
function pressByTitle(r: Awaited<ReturnType<typeof render>>, title: string) {
  const node = r.root.findAll((n) => n.props.title === title && typeof n.props.onPress === 'function')[0];
  if (!node) throw new Error(`No button titled "${title}"`);
  return act(async () => {
    node.props.onPress();
  });
}

describe('OwnerPhoneLoginScreen', () => {
  it('sends the code to the E.164 number and shows the same generic message', async () => {
    const { r } = await mountPhone();
    await typeText(r, 'owner-phone-number', '98765 43210');
    await pressByTitle(r, S.sendCode);
    await flush();
    expect(mockFetch).toHaveBeenCalledWith('auth/owner/otp/request', { method: 'POST', body: JSON.stringify({ phone: '+919876543210' }) });
    expect(has(r, 'owner-phone-code')).toBe(true);
    expect(allText(r)).toContain(S.requestSent(5));
    // The message never claims the number belongs to an owner.
    expect(allText(r).toLowerCase()).toContain('if this number');
  });

  it('rejects a number that cannot be valid without calling the API', async () => {
    const { r } = await mountPhone();
    await typeText(r, 'owner-phone-number', '12');
    await pressByTitle(r, S.sendCode);
    await flush();
    expect(allText(r)).toContain(S.invalidPhone);
    expect(mockFetch.mock.calls.some(([p]) => p === 'auth/owner/otp/request')).toBe(false);
  });

  it('uses the typed country code', async () => {
    const { r } = await mountPhone();
    await typeText(r, 'owner-phone-dial', '44');
    await typeText(r, 'owner-phone-number', '7700 900123');
    await pressByTitle(r, S.sendCode);
    await flush();
    expect(mockFetch).toHaveBeenCalledWith('auth/owner/otp/request', { method: 'POST', body: JSON.stringify({ phone: '+447700900123' }) });
  });

  it('keeps only digits in the code box, at most six', async () => {
    const { r } = await mountPhone();
    await typeText(r, 'owner-phone-number', '98765 43210');
    await pressByTitle(r, S.sendCode);
    await flush();
    await typeText(r, 'owner-phone-code', '12a3-45 678');
    expect(byTestId(r, 'owner-phone-code')[0].props.value).toBe('123456');
  });

  it('verifies the code and applies the returned session (no navigation call of its own)', async () => {
    const session = { user: { id: 'u1' }, tokens: { accessToken: 'a', refreshToken: 'r' } };
    mockFetch.mockImplementation(async (path: string) => (path === 'auth/owner/otp/verify' ? session : {}));
    const { r, navigation } = await mountPhone();
    await typeText(r, 'owner-phone-number', '98765 43210');
    await pressByTitle(r, S.sendCode);
    await flush();
    await typeText(r, 'owner-phone-code', '012345');
    await pressByTitle(r, S.verify);
    await flush();
    expect(mockFetch).toHaveBeenCalledWith('auth/owner/otp/verify', { method: 'POST', body: JSON.stringify({ phone: '+919876543210', code: '012345' }) });
    expect(mockApplySession).toHaveBeenCalledWith(session);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('does not call the API for a code that is not six digits', async () => {
    const { r } = await mountPhone();
    await typeText(r, 'owner-phone-number', '98765 43210');
    await pressByTitle(r, S.sendCode);
    await flush();
    await typeText(r, 'owner-phone-code', '123');
    await pressByTitle(r, S.verify);
    await flush();
    expect(allText(r)).toContain(S.invalidCode);
    expect(mockFetch.mock.calls.some(([p]) => p === 'auth/owner/otp/verify')).toBe(false);
    expect(mockApplySession).not.toHaveBeenCalled();
  });

  it('shows a generic recoverable message for an invalid or expired code and never the server text', async () => {
    const { r } = await mountPhone();
    await typeText(r, 'owner-phone-number', '98765 43210');
    await pressByTitle(r, S.sendCode);
    await flush();
    mockFetch.mockRejectedValueOnce(err(401));
    await typeText(r, 'owner-phone-code', '000000');
    await pressByTitle(r, S.verify);
    await flush();
    expect(allText(r)).toContain(S.invalidOrExpired);
    expect(allText(r)).not.toContain('server text must not be shown');
    expect(has(r, 'owner-phone-code')).toBe(true); // still on the code step
    expect(mockApplySession).not.toHaveBeenCalled();
  });

  it('shows the rate-limit, unavailable and network states', async () => {
    for (const [failure, text] of [[err(429), S.rateLimited], [err(503), S.unavailable], [new TypeError('Network request failed'), S.network]] as const) {
      const { r } = await mountPhone();
      mockFetch.mockRejectedValueOnce(failure);
      await typeText(r, 'owner-phone-number', '98765 43210');
      await pressByTitle(r, S.sendCode);
      await flush();
      expect(allText(r)).toContain(text);
      expect(has(r, 'owner-phone-code')).toBe(false); // a failed request does not advance to the code step
    }
  });

  it('disables Resend for 45 seconds and enables it afterwards', async () => {
    jest.useFakeTimers();
    try {
      const { r } = await mountPhone();
      await typeText(r, 'owner-phone-number', '98765 43210');
      await pressByTitle(r, S.sendCode);
      await flush();
      const resend = () => byTestId(r, 'owner-phone-resend')[0];
      expect(resend().props.disabled).toBe(true);
      expect(allText(r)).toContain(S.resendIn(45));
      await advance(20_000);
      expect(allText(r)).toContain(S.resendIn(25));
      expect(resend().props.disabled).toBe(true); // still cooling down at 20s
      await advance(26_000);
      expect(resend().props.disabled).toBe(false);
      expect(allText(r)).toContain(S.resend);
    } finally {
      jest.useRealTimers();
    }
  });

  it('lets the owner go back to change the number, and back to email sign-in', async () => {
    const { r, navigation } = await mountPhone();
    await typeText(r, 'owner-phone-number', '98765 43210');
    await pressByTitle(r, S.sendCode);
    await flush();
    await press(r, 'owner-phone-change');
    expect(has(r, 'owner-phone-number')).toBe(true);
    expect(has(r, 'owner-phone-code')).toBe(false);
    await press(r, 'owner-phone-email');
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('speaks Hindi when the app language is Hindi', async () => {
    mockLanguage = 'HI';
    const { r } = await mountPhone();
    expect(allText(r)).toContain(ownerPhoneStrings('HI').title);
  });

  it('does not offer a second sign-in while a request is already running', async () => {
    let release: (v: unknown) => void = () => {};
    mockFetch.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const { r } = await mountPhone();
    await typeText(r, 'owner-phone-number', '98765 43210');
    await pressByTitle(r, S.sendCode);
    const before = mockFetch.mock.calls.filter(([p]) => p === 'auth/owner/otp/request').length;
    expect(before).toBe(1);
    await act(async () => { release({}); });
    await flush();
  });
});

describe('Entry point on the owner sign-in screen', () => {
  async function mountLogin(role: 'OWNER' | 'STAFF') {
    const navigation = nav();
    const r = await render(createElement(OwnerStaffLoginScreen as never, { navigation, route: { params: { role } } } as never));
    mounted.push(r);
    await flush();
    return { r, navigation };
  }

  it('offers sign-in with phone to owners only when the server reports ownerPhoneOtp', async () => {
    const { r, navigation } = await mountLogin('OWNER');
    expect(has(r, 'owner-sign-in-with-phone')).toBe(true);
    await press(r, 'owner-sign-in-with-phone');
    expect(navigation.navigate).toHaveBeenCalledWith('OwnerPhoneLogin');
  });

  it('does not offer it when the capability is off, missing, or the probe fails', async () => {
    for (const methods of [{ google: true, phoneOtp: true, ownerPhoneOtp: false }, { google: true, phoneOtp: true }]) {
      mockFetch.mockImplementation(async () => methods);
      const { r } = await mountLogin('OWNER');
      expect(has(r, 'owner-sign-in-with-phone')).toBe(false);
    }
    mockFetch.mockRejectedValue(new Error('offline'));
    const { r } = await mountLogin('OWNER');
    expect(has(r, 'owner-sign-in-with-phone')).toBe(false);
  });

  it('never offers it on the staff sign-in', async () => {
    const { r } = await mountLogin('STAFF');
    expect(has(r, 'owner-sign-in-with-phone')).toBe(false);
  });
});
