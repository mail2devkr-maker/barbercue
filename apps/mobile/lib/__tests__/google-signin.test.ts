/// <reference types="jest" />
import type { UiStrings } from '@barbercue/shared';

const mockConfigure = jest.fn();
const mockCheckPlayServices = jest.fn();
const mockSignIn = jest.fn();
const mockCreateAccount = jest.fn();
const mockPresentExplicitSignIn = jest.fn();

jest.mock('react-native-nitro-google-signin', () => ({
  GoogleOneTapSignIn: {
    configure: mockConfigure,
    checkPlayServices: mockCheckPlayServices,
    signIn: mockSignIn,
    createAccount: mockCreateAccount,
    presentExplicitSignIn: mockPresentExplicitSignIn,
  },
  isCancelledResponse: (response: { kind?: string }) => response?.kind === 'cancelled',
  isErrorWithCode: (error: { code?: string }) => Boolean(error?.code),
  isNoSavedCredentialFoundResponse: (response: { kind?: string }) => response?.kind === 'no-saved-credential',
  isSuccessResponse: (response: { kind?: string }) => response?.kind === 'success',
  statusCodes: { SIGN_IN_CANCELLED: 'CANCELLED' },
}));

const t = {
  googleSignInUnavailable: 'Google sign-in is not available in this build.',
  googlePlayServicesUnavailable: 'Google Play Services is unavailable or out of date on this device.',
  couldNotOpenGooglePicker: 'Could not open the Google account picker.',
  googleNoTokenReturned: 'Google did not return a sign-in token. Please try again.',
  couldNotCompleteGoogleSignIn: 'Could not complete Google sign-in. Please try again.',
} as UiStrings;

type GoogleSignInTestConfiguration = {
  webClientId?: string;
  iosClientId?: string;
  platform?: 'android' | 'ios';
};

function loadGoogleSignIn({
  webClientId,
  iosClientId,
  platform = 'android',
}: GoogleSignInTestConfiguration = {}) {
  jest.resetModules();
  if (webClientId === undefined) {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  } else {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = webClientId;
  }
  if (iosClientId === undefined) {
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  } else {
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = iosClientId;
  }
  jest.doMock('react-native', () => ({ Platform: { OS: platform } }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../google-signin') as typeof import('../google-signin');
}

describe('native Google Sign-In service', () => {
  let originalWebClientId: string | undefined;
  let originalIosClientId: string | undefined;

  beforeEach(() => {
    originalWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    originalIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalWebClientId === undefined) {
      delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    } else {
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = originalWebClientId;
    }
    if (originalIosClientId === undefined) {
      delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    } else {
      process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = originalIosClientId;
    }
  });

  it('returns a visible recoverable configuration error instead of silently attempting sign-in without a web client ID', async () => {
    const { getGoogleIdToken } = loadGoogleSignIn({
      iosClientId: '123456789012-test_client.apps.googleusercontent.com',
      platform: 'android',
    });

    await expect(getGoogleIdToken(t)).resolves.toEqual({
      type: 'error',
      stage: 'PLAY_SERVICES',
      message: t.googleSignInUnavailable,
    });
    expect(mockConfigure).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('keeps the iOS OAuth audience out of Android configuration even when the variable is present', async () => {
    const { getGoogleIdToken } = loadGoogleSignIn({
      webClientId: 'web-client-id.apps.googleusercontent.com',
      iosClientId: '123456789012-test_client.apps.googleusercontent.com',
      platform: 'android',
    });
    mockSignIn.mockResolvedValue({
      kind: 'success',
      data: { idToken: 'id-token' },
    });

    await expect(getGoogleIdToken(t)).resolves.toEqual({
      type: 'success',
      idToken: 'id-token',
    });
    expect(mockConfigure).toHaveBeenCalledWith({
      webClientId: 'web-client-id.apps.googleusercontent.com',
    });
    expect(mockCheckPlayServices).toHaveBeenCalledTimes(1);
    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it('includes the iOS OAuth audience when configuring an iOS build', async () => {
    const { getGoogleIdToken } = loadGoogleSignIn({
      webClientId: 'web-client-id.apps.googleusercontent.com',
      iosClientId: '123456789012-test_client.apps.googleusercontent.com',
      platform: 'ios',
    });
    mockSignIn.mockResolvedValue({
      kind: 'success',
      data: { idToken: 'id-token' },
    });

    await expect(getGoogleIdToken(t)).resolves.toEqual({
      type: 'success',
      idToken: 'id-token',
    });
    expect(mockConfigure).toHaveBeenCalledWith({
      webClientId: 'web-client-id.apps.googleusercontent.com',
      iosClientId: '123456789012-test_client.apps.googleusercontent.com',
    });
  });

  it('uses an iOS OAuth client only on iOS and preserves Android configuration', () => {
    const { getGoogleSignInConfiguration } = loadGoogleSignIn({ platform: 'android' });
    expect(getGoogleSignInConfiguration('web-client-id', 'ios-client-id', 'ios')).toEqual({
      webClientId: 'web-client-id',
      iosClientId: 'ios-client-id',
    });
    expect(getGoogleSignInConfiguration('web-client-id', 'ios-client-id', 'android')).toEqual({
      webClientId: 'web-client-id',
    });
  });

  it('uses the documented interactive fallbacks for a first-time Google user', async () => {
    const { getGoogleIdToken } = loadGoogleSignIn({ webClientId: 'web-client-id.apps.googleusercontent.com' });
    mockSignIn.mockResolvedValue({ kind: 'no-saved-credential' });
    mockCreateAccount.mockResolvedValue({ kind: 'no-saved-credential' });
    mockPresentExplicitSignIn.mockResolvedValue({
      kind: 'success',
      data: { idToken: 'id-token' },
    });

    await expect(getGoogleIdToken(t)).resolves.toEqual({
      type: 'success',
      idToken: 'id-token',
    });
    expect(mockCreateAccount).toHaveBeenCalledTimes(1);
    expect(mockPresentExplicitSignIn).toHaveBeenCalledTimes(1);
  });

  it('returns a typed account-picker error for the UI to show when native Google authentication fails', async () => {
    const { getGoogleIdToken } = loadGoogleSignIn({ webClientId: 'web-client-id.apps.googleusercontent.com' });
    mockSignIn.mockRejectedValue(new Error('native configuration failed'));

    await expect(getGoogleIdToken(t)).resolves.toEqual({
      type: 'error',
      stage: 'ACCOUNT_PICKER',
      message: t.couldNotOpenGooglePicker,
    });
  });
});

