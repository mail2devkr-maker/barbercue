/**
 * Dynamic Expo config for platform-specific native settings that depend on build-time
 * public OAuth identifiers. The iOS Google client ID is public by design; it is never a
 * credential or secret.
 */

function googleIosUrlScheme(clientId) {
  const id = (clientId || '').trim();
  const match = /^([0-9]+-[A-Za-z0-9_-]+)\.apps\.googleusercontent\.com$/.exec(id);
  return match ? `com.googleusercontent.apps.${match[1]}` : null;
}

function withIosGoogleUrlScheme(plugins, iosUrlScheme) {
  if (!iosUrlScheme) return plugins;

  return (plugins || []).map((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    if (name !== 'react-native-nitro-google-signin') return plugin;

    const existingOptions = Array.isArray(plugin) && plugin[1] && typeof plugin[1] === 'object'
      ? plugin[1]
      : {};

    return [
      'react-native-nitro-google-signin',
      {
        ...existingOptions,
        iosUrlScheme,
      },
    ];
  });
}

module.exports = ({ config }) => {
  const isIosBuild = process.env.FASTQUE_IOS_BUILD === 'true';
  if (!isIosBuild) return config;

  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const iosUrlScheme = googleIosUrlScheme(iosClientId);

  if (!iosUrlScheme) {
    throw new Error(
      'FastQue iOS build requires EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID to be a valid Google iOS OAuth client ID.',
    );
  }

  return {
    ...config,
    plugins: withIosGoogleUrlScheme(config.plugins, iosUrlScheme),
  };
};

module.exports.googleIosUrlScheme = googleIosUrlScheme;
module.exports.withIosGoogleUrlScheme = withIosGoogleUrlScheme;
