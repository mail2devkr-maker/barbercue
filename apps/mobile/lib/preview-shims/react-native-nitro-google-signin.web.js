// PREVIEW-ONLY SHIM — never bundled into the real Android/iOS app. See metro.config.js and
// expo-notifications.web.js's own header comment for the full explanation of why this pattern
// exists and why it is safe: this file is only reachable through metro.config.js's
// resolver.resolveRequest override, which fires ONLY when Metro bundles for `platform === 'web'`.
//
// react-native-nitro-google-signin is a Nitro (TurboModule-backed) native module — merely
// `import ... from 'react-native-nitro-google-signin'` in lib/google-signin.ts pulls in
// react-native's TurboModuleRegistry at module-evaluation time, which crashes the web bundle
// (`Your web project is importing a module from 'react-native' instead of 'react-native-web'`)
// before any of this app's own `GOOGLE_SIGNIN_CONFIGURED` guard ever runs — this module is
// evaluated eagerly as part of the app's screen graph regardless of which screen is on-screen,
// since Expo/React Navigation does not code-split screens by default. Google sign-in itself is
// still not meaningfully testable in a browser preview (it is a native Credential Manager flow),
// so every export here is an inert stub — the preview harness's purpose is letting OTHER screens
// (like Home) render at all, not exercising this flow.

function rejectCancelled() {
  return Promise.reject(Object.assign(new Error('Google sign-in is stubbed out in the web preview build'), { code: 'SIGN_IN_CANCELLED' }));
}

module.exports = {
  GoogleOneTapSignIn: {
    configure: () => undefined,
    checkPlayServices: rejectCancelled,
    signIn: rejectCancelled,
    createAccount: rejectCancelled,
    presentExplicitSignIn: rejectCancelled,
  },
  isCancelledResponse: () => true,
  isErrorWithCode: (err) => Boolean(err && typeof err === 'object' && 'code' in err),
  isNoSavedCredentialFoundResponse: () => false,
  isSuccessResponse: () => false,
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
};
