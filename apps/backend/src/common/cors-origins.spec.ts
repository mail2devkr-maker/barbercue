import { resolveCorsOrigins } from './cors-origins';

describe('resolveCorsOrigins', () => {
  it('parses a comma-separated CORS_ALLOWED_ORIGINS, trimming whitespace and dropping empties', () => {
    expect(
      resolveCorsOrigins({
        CORS_ALLOWED_ORIGINS: ' https://fastque.com , https://barbercueweb-production.up.railway.app ,,',
      } as NodeJS.ProcessEnv),
    ).toEqual(['https://fastque.com', 'https://barbercueweb-production.up.railway.app']);
  });

  it('CORS_ALLOWED_ORIGINS takes priority over NODE_ENV, even in production', () => {
    expect(
      resolveCorsOrigins({
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: 'https://custom.example.com',
      } as NodeJS.ProcessEnv),
    ).toEqual(['https://custom.example.com']);
  });

  it('falls back to the known production web origins when unset in production — never reflects any origin', () => {
    const origins = resolveCorsOrigins({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    expect(origins).toEqual([
      'https://fastque.com',
      'https://barbercueweb-production.up.railway.app',
    ]);
    expect(origins).not.toContain('*');
  });

  it('falls back to localhost dev origins when unset outside production', () => {
    const origins = resolveCorsOrigins({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(origins).toEqual(expect.arrayContaining(['http://localhost:3000', 'http://localhost:3001']));
  });

  it('includes a non-default WEB_BASE_URL in the dev fallback', () => {
    const origins = resolveCorsOrigins({
      NODE_ENV: 'development',
      WEB_BASE_URL: 'http://localhost:3099',
    } as NodeJS.ProcessEnv);
    expect(origins).toContain('http://localhost:3099');
  });
});
