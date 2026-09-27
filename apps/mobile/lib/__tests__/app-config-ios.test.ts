/// <reference types="jest" />

type ExpoConfigFn = ((input: { config: Record<string, unknown> }) => Record<string, unknown>) & {
  googleIosUrlScheme: (clientId?: string) => string | null;
  withIosGoogleUrlScheme: (plugins: unknown[], iosUrlScheme: string | null) => unknown[];
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require('../../app.config.js') as ExpoConfigFn;

describe('FastQue iOS Expo config', () => {
  const originalProfile = process.env.EAS_BUILD_PROFILE;
  const originalIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

  afterEach(() => {
    if (originalProfile === undefined) delete process.env.EAS_BUILD_PROFILE;
    else process.env.EAS_BUILD_PROFILE = originalProfile;

    if (originalIosClientId === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    else process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = originalIosClientId;
  });

  it('derives the reversed Google URL scheme from a valid iOS OAuth client ID', () => {
    expect(
      appConfig.googleIosUrlScheme('871155185690-example.apps.googleusercontent.com'),
    ).toBe('com.googleusercontent.apps.871155185690-example');
  });

  it('rejects malformed iOS client IDs instead of inventing a URL scheme', () => {
    expect(appConfig.googleIosUrlScheme('not-a-google-client')).toBeNull();
  });

  it('injects iosUrlScheme into the Nitro Google Sign-In config plugin', () => {
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID =
      '871155185690-example.apps.googleusercontent.com';

    const result = appConfig({
      config: {
        plugins: ['expo-secure-store', 'react-native-nitro-google-signin'],
      },
    });

    expect(result.plugins).toEqual([
      'expo-secure-store',
      [
        'react-native-nitro-google-signin',
        { iosUrlScheme: 'com.googleusercontent.apps.871155185690-example' },
      ],
    ]);
  });

  it('fails closed for the physical iOS build profile when the iOS OAuth client ID is missing', () => {
    process.env.EAS_BUILD_PROFILE = 'ios-physical';
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

    expect(() =>
      appConfig({
        config: { plugins: ['react-native-nitro-google-signin'] },
      }),
    ).toThrow(/EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID/);
  });
});
