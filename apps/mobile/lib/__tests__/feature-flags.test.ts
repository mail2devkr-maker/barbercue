import { isCreditsEnabled } from '../feature-flags';

describe('FastQue Credits release gate', () => {
  const ORIGINAL = process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED;
    } else {
      process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED = ORIGINAL;
    }
  });

  it('is disabled when the flag is unset', () => {
    delete process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED;
    expect(isCreditsEnabled()).toBe(false);
  });

  it('is disabled when explicitly set to "false"', () => {
    process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED = 'false';
    expect(isCreditsEnabled()).toBe(false);
  });

  it('is disabled for malformed values', () => {
    for (const value of ['False', 'TRUE', 'enabled', '', ' true']) {
      process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED = value;
      expect(isCreditsEnabled()).toBe(false);
    }
  });

  it('is enabled only when explicitly set to the literal string "true"', () => {
    process.env.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED = 'true';
    expect(isCreditsEnabled()).toBe(true);
  });
});
