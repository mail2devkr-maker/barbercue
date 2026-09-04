import {
  GoogleOneTapSignIn,
  isCancelledResponse,
  isErrorWithCode,
  isNoSavedCredentialFoundResponse,
  isSuccessResponse,
  statusCodes,
} from 'react-native-nitro-google-signin';
import type { UiStrings } from '@barbercue/shared';

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

// Whether this build has a Google web client ID at all — screens use this to decide whether to
// render a "Continue with Google" button in the first place.
export const GOOGLE_SIGNIN_CONFIGURED = Boolean(GOOGLE_WEB_CLIENT_ID);

// GoogleOneTapSignIn.configure() is a native singleton — calling it more than once is wasted work
// (and, on some SDK versions, redundant native calls). Both the customer and owner/staff login
// screens need it configured before their first sign-in attempt; previously only the customer
// screen's module-load side effect did this, which made the owner/staff screen depend on that
// module having been imported first. This lazily configures on first actual use instead, so
// neither screen needs to know about the other.
let configured = false;
function ensureConfigured(): void {
  if (configured || !GOOGLE_WEB_CLIENT_ID) return;
  GoogleOneTapSignIn.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  configured = true;
}

export type GoogleSignInStage = 'PLAY_SERVICES' | 'ACCOUNT_PICKER' | 'TOKEN';

export type GoogleSignInResult =
  | { type: 'success'; idToken: string }
  | { type: 'cancelled' }
  | { type: 'error'; stage: GoogleSignInStage; message: string };

// Drives the native Credential Manager flow end to end and always resolves to a typed result —
// never throws, never silently returns without one of success/cancelled/error. That matters
// because the Google SDK's response/exception shapes aren't a closed set we fully control (SDK
// updates can add response variants), so any branch that fell through unhandled would look to the
// user like a dead button with nothing in the logs. Callers must not log idToken or any other
// token value from the result.
export async function getGoogleIdToken(t: UiStrings): Promise<GoogleSignInResult> {
  if (!GOOGLE_WEB_CLIENT_ID) {
    return { type: 'error', stage: 'PLAY_SERVICES', message: t.googleSignInUnavailable };
  }
  ensureConfigured();

  try {
    await GoogleOneTapSignIn.checkPlayServices();
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) return { type: 'cancelled' };
    return {
      type: 'error',
      stage: 'PLAY_SERVICES',
      message: t.googlePlayServicesUnavailable,
    };
  }

  let response;
  try {
    response = await GoogleOneTapSignIn.signIn();
    // No saved credential is the expected "first time on this device" case, not a failure. The
    // library's documented Android Credential Manager flow has two interactive fallbacks:
    // createAccount() first, then presentExplicitSignIn() if Credential Manager still reports no
    // saved credential. Without the second fallback, first-time/cleared-credential users fall
    // through to the generic TOKEN error even though Google sign-in is actually available.
    if (isNoSavedCredentialFoundResponse(response)) {
      response = await GoogleOneTapSignIn.createAccount();
    }
    if (isNoSavedCredentialFoundResponse(response)) {
      response = await GoogleOneTapSignIn.presentExplicitSignIn();
    }
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) return { type: 'cancelled' };
    return { type: 'error', stage: 'ACCOUNT_PICKER', message: t.couldNotOpenGooglePicker };
  }

  if (isCancelledResponse(response)) return { type: 'cancelled' };

  if (isSuccessResponse(response)) {
    const idToken = response.data?.idToken;
    if (!idToken) {
      return { type: 'error', stage: 'TOKEN', message: t.googleNoTokenReturned };
    }
    return { type: 'success', idToken };
  }

  // A response shape none of the guards above recognized (e.g. an SDK version returning something
  // new). Surface it as an error rather than falling through silently.
  return { type: 'error', stage: 'TOKEN', message: t.couldNotCompleteGoogleSignIn };
}
