// Monorepo Metro config — lets Metro resolve @barbercue/shared (an npm workspace package that
// lives outside apps/mobile) via the root node_modules symlink. Standard Expo-monorepo pattern.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// PREVIEW-ONLY: a couple of native (TurboModule-backed) packages crash at module-evaluation time
// when Metro bundles for `platform === 'web'` — importing them at all pulls in react-native's
// TurboModuleRegistry, which throws immediately with "Your web project is importing a module from
// 'react-native' instead of 'react-native-web'" (https://expo.fyi/fb-batched-bridge-config-web),
// before any of this app's own Platform.OS guards ever run. Neither is a bug in this app's guard
// logic — both packages simply have no web target. This redirect only ever fires for the web
// platform target used by the `npm run web` / mobile-web preview harness; every Android/iOS build
// (`expo run:android`, `expo run:ios`, EAS builds) resolves the real packages completely
// unaffected, via the `context.resolveRequest(...)` fallback below. Production push-notification
// and Google sign-in behavior is untouched — see each shim file's own header comment.
const WEB_PREVIEW_SHIMS = {
  'expo-notifications': 'lib/preview-shims/expo-notifications.web.js',
  'react-native-nitro-google-signin': 'lib/preview-shims/react-native-nitro-google-signin.web.js',
};
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform, ...rest) => {
  if (platform === 'web' && WEB_PREVIEW_SHIMS[moduleName]) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(projectRoot, WEB_PREVIEW_SHIMS[moduleName]),
    };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform, ...rest);
  }
  return context.resolveRequest(context, moduleName, platform, ...rest);
};

module.exports = config;
