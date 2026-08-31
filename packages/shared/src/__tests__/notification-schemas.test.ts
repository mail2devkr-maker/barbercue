import { registerPushDeviceSchema, unregisterPushDeviceSchema } from '../schemas';

describe('push device schemas', () => {
  const valid = {
    platform: 'ANDROID',
    provider: 'EXPO',
    pushToken: 'ExpoPushToken[abc_123-xyz]',
    installationId: 'installation-1234',
  } as const;

  it('accepts an Expo installation registration without a target user id', () => {
    expect(registerPushDeviceSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an arbitrary userId instead of silently stripping it', () => {
    expect(() => registerPushDeviceSchema.parse({ ...valid, userId: 'victim' })).toThrow();
  });

  it('rejects non-Expo token shapes', () => {
    expect(() => registerPushDeviceSchema.parse({ ...valid, pushToken: 'fcm-secret' })).toThrow();
  });

  it('only unregisters by installation identity, never arbitrary userId', () => {
    expect(
      unregisterPushDeviceSchema.parse({
        provider: 'EXPO',
        installationId: valid.installationId,
      }),
    ).toEqual({ provider: 'EXPO', installationId: valid.installationId });
  });
});
