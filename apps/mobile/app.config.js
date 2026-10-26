/**
 * iOS-only native configuration. Android continues to consume app.json unchanged.
 * The iOS client ID is a public OAuth identifier, not a credential.
 */
function googleIosUrlScheme(clientId) {
  const id = (clientId || '').trim();
  const match = /^([0-9]+-[A-Za-z0-9_-]+)\.apps\.googleusercontent\.com$/.exec(id);
  return match ? `com.googleusercontent.apps.${match[1]}` : null;
}

function withIosGoogleUrlScheme(plugins, iosUrlScheme) {
  let found = false;
  const updated = (plugins || []).map((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    if (name !== 'react-native-nitro-google-signin') return plugin;

    found = true;
    const existingOptions = Array.isArray(plugin) && plugin[1] && typeof plugin[1] === 'object'
      ? plugin[1]
      : {};
    return [name, { ...existingOptions, iosUrlScheme }];
  });

  if (!found) {
    throw new Error('FastQue iOS build requires the react-native-nitro-google-signin config plugin.');
  }
  return updated;
}

module.exports = ({ config }) => {
  if (process.env.FASTQUE_IOS_BUILD !== 'true') return config;

  const iosUrlScheme = googleIosUrlScheme(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
  if (!iosUrlScheme) {
    throw new Error(
      'FastQue iOS build requires EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID to be a valid Google iOS OAuth client ID.',
    );
  }

  return { ...config, plugins: withIosGoogleUrlScheme(config.plugins, iosUrlScheme) };
};

module.exports.googleIosUrlScheme = googleIosUrlScheme;
module.exports.withIosGoogleUrlScheme = withIosGoogleUrlScheme;
