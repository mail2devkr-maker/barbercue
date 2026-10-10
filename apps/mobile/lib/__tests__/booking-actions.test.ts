const share = {
  salonCountryCode: 'IN',
  citySlug: 'gorakhpur-uttar-pradesh',
  salonSlug: 'ajay-men-s-parlour',
};

function loadWith(env: string | undefined, dev: boolean) {
  const previousEnv = process.env.EXPO_PUBLIC_WEB_ORIGIN;
  const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;
  if (env === undefined) delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
  else process.env.EXPO_PUBLIC_WEB_ORIGIN = env;
  (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
  try {
    let mod: typeof import('../booking-actions') | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../booking-actions');
    });
    return mod as typeof import('../booking-actions');
  } finally {
    if (previousEnv === undefined) delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
    else process.env.EXPO_PUBLIC_WEB_ORIGIN = previousEnv;
    (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
  }
}

describe('resolveWebOrigin', () => {
  it('uses the configured origin and trims whitespace and trailing slashes', () => {
    const { resolveWebOrigin } = loadWith(undefined, true);
    expect(resolveWebOrigin('https://staging.example.com/', false)).toBe('https://staging.example.com');
    expect(resolveWebOrigin('  https://staging.example.com//  ', true)).toBe('https://staging.example.com');
  });

  it('falls back to the local web app in development and to fastque.com in release builds', () => {
    const { resolveWebOrigin } = loadWith(undefined, true);
    expect(resolveWebOrigin(undefined, true)).toBe('http://localhost:3001');
    expect(resolveWebOrigin(undefined, false)).toBe('https://fastque.com');
    expect(resolveWebOrigin('   ', false)).toBe('https://fastque.com');
  });
});

describe('salonPageUrl (generated booking share links)', () => {
  it('builds the canonical public link in a release build with no origin configured', () => {
    const { salonPageUrl } = loadWith(undefined, false);
    expect(salonPageUrl(share)).toBe('https://fastque.com/in/gorakhpur-uttar-pradesh/ajay-men-s-parlour');
    expect(salonPageUrl(share)).not.toContain('localhost');
  });

  it('keeps the local web app for development builds with no origin configured', () => {
    const { salonPageUrl } = loadWith(undefined, true);
    expect(salonPageUrl(share)).toBe('http://localhost:3001/in/gorakhpur-uttar-pradesh/ajay-men-s-parlour');
  });

  it('honours an explicit EXPO_PUBLIC_WEB_ORIGIN in every build type', () => {
    expect(loadWith('https://barbercueweb-production.up.railway.app', false).salonPageUrl(share)).toBe(
      'https://barbercueweb-production.up.railway.app/in/gorakhpur-uttar-pradesh/ajay-men-s-parlour',
    );
  });
});
