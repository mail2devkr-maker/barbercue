import { isCreditsEnabled } from '../feature-flags';

describe('FastQue Credits release gate', () => {
  const ORIGINAL = process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED;

  afterEach(() => {
    process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED = ORIGINAL;
  });

  it('is enabled by default when the var is unset (local dev, preview builds)', () => {
    delete process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED;
    expect(isCreditsEnabled()).toBe(true);
  });

  it('is disabled only when explicitly set to the literal string "false" (eas.json production)', () => {
    process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED = 'false';
    expect(isCreditsEnabled()).toBe(false);
  });

  it('stays enabled for any other value, so a typo never silently disables it', () => {
    process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED = 'False';
    expect(isCreditsEnabled()).toBe(true);
    process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED = 'true';
    expect(isCreditsEnabled()).toBe(true);
  });
});
