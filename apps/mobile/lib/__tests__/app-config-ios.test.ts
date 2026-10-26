/// <reference types="jest" />

type ExpoConfigFn = ((input: { config: Record<string, unknown> }) => Record<string, unknown>) & {
  googleIosUrlScheme: (clientId?: string) => string | null;
  withIosGoogleUrlScheme: (plugins: unknown[], iosUrlScheme: string) => unknown[];
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require('../../app.config.js') as ExpoConfigFn;

describe('FastQue iOS Expo config', () => {
  const originalIosBuild = process.env.FASTQUE_IOS_BUILD;
  const originalIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

  afterEach(() => {
    if (originalIosBuild === undefined) delete process.env.FASTQUE_IOS_BUILD;
    else process.env.FASTQUE_IOS_BUILD = originalIosBuild;
    if (originalIosClientId === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    else process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = originalIosClientId;
  });

  it('derives the reversed URL scheme from a valid iOS client ID', () => {
    expect(appConfig.googleIosUrlScheme('123456789012-test_client.apps.googleusercontent.com'))
      .toBe('com.googleusercontent.apps.123456789012-test_client');
  });

  it('rejects malformed client IDs rather than inventing a URL scheme', () => {
    expect(appConfig.googleIosUrlScheme('not-a-google-client')).toBeNull();
  });

  it('adds the URL scheme while preserving existing Google plugin options', () => {
    const result = appConfig.withIosGoogleUrlScheme(
      ['expo-secure-store', ['react-native-nitro-google-signin', { existingOption: true }]],
      'com.googleusercontent.apps.123456789012-test',
    );
    expect(result).toEqual([
      'expo-secure-store',
      ['react-native-nitro-google-signin', {
        existingOption: true,
        iosUrlScheme: 'com.googleusercontent.apps.123456789012-test',
      }],
    ]);
  });

  it('fails if the app no longer includes the required native sign-in plugin', () => {
    expect(() => appConfig.withIosGoogleUrlScheme(['expo-secure-store'], 'scheme'))
      .toThrow(/requires the react-native-nitro-google-signin config plugin/);
  });

  it('does not change native config when the iOS build gate is off', () => {
    delete process.env.FASTQUE_IOS_BUILD;
    const config = { plugins: ['react-native-nitro-google-signin'] };
    expect(appConfig({ config })).toBe(config);
  });

  it('fails closed when an iOS build has no valid iOS OAuth client ID', () => {
    process.env.FASTQUE_IOS_BUILD = 'true';
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    expect(() => appConfig({ config: { plugins: ['react-native-nitro-google-signin'] } }))
      .toThrow(/EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID/);
  });
});
