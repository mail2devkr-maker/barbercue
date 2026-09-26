// Dynamic Expo config used only for values that must differ by build environment.
// Static product configuration remains in app.json.
const IOS_GOOGLE_CLIENT_SUFFIX = '.apps.googleusercontent.com';

function iosGoogleUrlScheme(clientId) {
  if (!clientId.endsWith(IOS_GOOGLE_CLIENT_SUFFIX)) {
    throw new Error('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID must be a Google OAuth iOS client ID ending in .apps.googleusercontent.com');
  }
  const clientPrefix = clientId.slice(0, -IOS_GOOGLE_CLIENT_SUFFIX.length);
  if (!clientPrefix) throw new Error('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is malformed');
  return `com.googleusercontent.apps.${clientPrefix}`;
}

module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  const plugins = (config.plugins ?? []).map((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    if (name !== 'react-native-nitro-google-signin' || !iosClientId) return plugin;
    const existingOptions = Array.isArray(plugin) && plugin[1] && typeof plugin[1] === 'object' ? plugin[1] : {};
    return [
      'react-native-nitro-google-signin',
      { ...existingOptions, iosUrlScheme: iosGoogleUrlScheme(iosClientId) },
    ];
  });

  return { ...config, plugins };
};
