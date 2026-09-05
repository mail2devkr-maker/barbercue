// PREVIEW-ONLY SHIM — never bundled into the real Android/iOS app.
//
// This file is only reachable through metro.config.js's resolver.resolveRequest override, which
// redirects the bare `expo-notifications` import to this module ONLY when Metro is bundling for
// `platform === 'web'` (the `expo start --web` / mobile-web preview harness used to visually QA
// screens in a browser). Every native/Android/iOS bundle continues to resolve the real
// `expo-notifications` package exactly as before — this file is never in that resolution path.
//
// Why this exists: merely `import * as Notifications from 'expo-notifications'` crashes the web
// bundle at module-evaluation time (before any of this app's own `Platform.OS !== 'web'` guards in
// PushNotificationCoordinator.tsx / lib/push-notifications.ts ever run) — a known expo-notifications
// web-compatibility gap, not a bug in this app's own code. TypeScript type-checking is completely
// unaffected by this file: `tsc` resolves `expo-notifications`'s real .d.ts via normal node_modules
// resolution, which has nothing to do with Metro's runtime bundler resolution.
//
// Every export below is a harmless, inert no-op — this app's own Platform.OS guards already skip
// calling most of these on web, so the exact return shape mostly doesn't matter, but each one
// matches the real module's shape closely enough that nothing that *does* run on web throws.

function noop() {}

module.exports = {
  setNotificationHandler: noop,
  addNotificationResponseReceivedListener: () => ({ remove: noop }),
  addPushTokenListener: () => ({ remove: noop }),
  getLastNotificationResponseAsync: async () => null,
  clearLastNotificationResponseAsync: async () => undefined,
  getPermissionsAsync: async () => ({ granted: false }),
  requestPermissionsAsync: async () => ({ granted: false }),
  getExpoPushTokenAsync: async () => {
    throw new Error('expo-notifications is stubbed out in the web preview build');
  },
  setNotificationChannelAsync: async () => undefined,
  AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1, NONE: 0 },
  AndroidNotificationVisibility: { PUBLIC: 1, PRIVATE: 0, SECRET: -1 },
};
