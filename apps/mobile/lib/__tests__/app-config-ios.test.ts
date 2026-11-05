/// <reference types="jest" />

type ExpoConfigFn = ((input: { config: Record<string, unknown> }) => Record<string, unknown>) & {
  googleIosUrlScheme: (clientId?: string) => string | null;
  withIosGoogleUrlScheme: (plugins: unknown[], iosUrlScheme: string | null) => unknown[];
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

  it('derives the reversed Google URL scheme from a valid iOS OAuth client ID', () => {
    expect(
      appConfig.googleIosUrlScheme('871155185690-example.apps.googleusercontent.com'),
    ).toBe('com.googleusercontent.apps.871155185690-example');
  });

  it('rejects malformed iOS client IDs instead of inventing a URL scheme', () => {
    expect(appConfig.googleIosUrlScheme('not-a-google-client')).toBeNull();
  });

  it('injects iosUrlScheme into the Nitro Google Sign-In config plugin', () => {
    process.env.FASTQUE_IOS_BUILD = 'true';
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

  it('leaves Android/native config untouched when the iOS build gate is off', () => {
    delete process.env.FASTQUE_IOS_BUILD;
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID =
      '871155185690-example.apps.googleusercontent.com';

    const input = { plugins: ['react-native-nitro-google-signin'] };
    expect(appConfig({ config: input })).toBe(input);
  });

  it('fails closed for an iOS build when the iOS OAuth client ID is missing', () => {
    process.env.FASTQUE_IOS_BUILD = 'true';
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

    expect(() =>
      appConfig({
        config: { plugins: ['react-native-nitro-google-signin'] },
      }),
    ).toThrow(/EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID/);
  });
});
