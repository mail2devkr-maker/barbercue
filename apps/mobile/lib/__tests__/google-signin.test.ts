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

function loadGoogleSignIn(webClientId?: string) {
  jest.resetModules();
  if (webClientId === undefined) {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  } else {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = webClientId;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../google-signin') as typeof import('../google-signin');
}

describe('native Google Sign-In service', () => {
  const originalWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalWebClientId === undefined) {
      delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    } else {
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = originalWebClientId;
    }
  });

  it('returns a visible recoverable configuration error instead of silently attempting sign-in without a web client ID', async () => {
    const { getGoogleIdToken } = loadGoogleSignIn();

    await expect(getGoogleIdToken(t)).resolves.toEqual({
      type: 'error',
      stage: 'PLAY_SERVICES',
      message: t.googleSignInUnavailable,
    });
    expect(mockConfigure).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('configures Credential Manager and invokes the Google action for a configured build', async () => {
    const { getGoogleIdToken } = loadGoogleSignIn('web-client-id.apps.googleusercontent.com');
    mockSignIn.mockResolvedValue({ kind: 'success', data: { idToken: 'id-token' } });

    await expect(getGoogleIdToken(t)).resolves.toEqual({ type: 'success', idToken: 'id-token' });
    expect(mockConfigure).toHaveBeenCalledWith({ webClientId: 'web-client-id.apps.googleusercontent.com' });
    expect(mockCheckPlayServices).toHaveBeenCalledTimes(1);
    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it('uses the documented interactive fallbacks for a first-time Google user', async () => {
    const { getGoogleIdToken } = loadGoogleSignIn('web-client-id.apps.googleusercontent.com');
    mockSignIn.mockResolvedValue({ kind: 'no-saved-credential' });
    mockCreateAccount.mockResolvedValue({ kind: 'no-saved-credential' });
    mockPresentExplicitSignIn.mockResolvedValue({ kind: 'success', data: { idToken: 'id-token' } });

    await expect(getGoogleIdToken(t)).resolves.toEqual({ type: 'success', idToken: 'id-token' });
    expect(mockCreateAccount).toHaveBeenCalledTimes(1);
    expect(mockPresentExplicitSignIn).toHaveBeenCalledTimes(1);
  });

  it('returns a typed account-picker error for the UI to show when native Google authentication fails', async () => {
    const { getGoogleIdToken } = loadGoogleSignIn('web-client-id.apps.googleusercontent.com');
    mockSignIn.mockRejectedValue(new Error('native configuration failed'));

    await expect(getGoogleIdToken(t)).resolves.toEqual({
      type: 'error',
      stage: 'ACCOUNT_PICKER',
      message: t.couldNotOpenGooglePicker,
    });
  });
});
