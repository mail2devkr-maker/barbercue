import {
  QA_BACKEND_ISOLATION_ERROR,
  resolveMobileApiBaseUrl,
} from '../qa-backend-isolation';

describe('FastQue Android QA API backend isolation', () => {
  const qa = (configuredUrl?: string) => resolveMobileApiBaseUrl({
    configuredUrl,
    qaIsolated: true,
    development: false,
  });

  it('preserves the existing public production URL fallback outside QA mode', () => {
    expect(resolveMobileApiBaseUrl({
      qaIsolated: false,
      development: false,
    })).toBe('https://barbercuebackend-production.up.railway.app/api/v1');

    expect(resolveMobileApiBaseUrl({
      qaIsolated: false,
      development: true,
    })).toBe('http://localhost:3000/api/v1');

    expect(resolveMobileApiBaseUrl({
      qaIsolated: false,
      development: false,
      configuredUrl: 'https://example.org/api/v1',
    })).toBe('https://example.org/api/v1');
  });

  it('requires an explicit API origin when QA is enabled', () => {
    expect(() => qa()).toThrow(QA_BACKEND_ISOLATION_ERROR);
    expect(() => qa('  ')).toThrow(QA_BACKEND_ISOLATION_ERROR);
  });

  it('rejects both the legacy production fallback and a production-marked EAS preview API', () => {
    for (const url of [
      'https://barbercuebackend-production.up.railway.app/api/v1',
      'https://fastque-production.up.railway.app/api/v1',
      'https://api.fastque.com/api/v1',
      'https://example.org/api/v1',
      'https://10.0.2.2.evil.example/api/v1',
    ]) {
      expect(() => qa(url)).toThrow(QA_BACKEND_ISOLATION_ERROR);
    }
  });

  it('allows only explicitly configured local loopback QA APIs', () => {
    expect(qa('http://10.0.2.2:3000/api/v1')).toBe('http://10.0.2.2:3000/api/v1');
    expect(qa(' http://localhost:3000/api/v1/ ')).toBe('http://localhost:3000/api/v1');
    expect(qa('http://127.0.0.1:3000/api/v1')).toBe('http://127.0.0.1:3000/api/v1');
  });

  it('rejects unsafe URLs, embedded credentials, wrong paths, and malformed ports', () => {
    for (const url of [
      'http://10.0.2.2:3000',
      'http://10.0.2.2:3000/',
      'http://10.0.2.2:3000/api/v1?key=secret',
      'http://10.0.2.2:3000/api/v1#test',
      'http://user:pass@127.0.0.1:3000/api/v1',
      'http://localhost:99999/api/v1',
      'http://localhost:0/api/v1',
      'http://192.168.1.100:3000/api/v1',
      'http://10.0.2.2:3000/api/v1/../../admin',
      '//10.0.2.2:3000/api/v1',
      'https://127.0.0.1.evil.example/api/v1',
    ]) {
      expect(() => qa(url)).toThrow(QA_BACKEND_ISOLATION_ERROR);
    }
  });

  it('does not allow an invalid URL even when __DEV__ is enabled', () => {
    expect(() => resolveMobileApiBaseUrl({
      qaIsolated: true,
      development: true,
      configuredUrl: 'https://barbercuebackend-production.up.railway.app/api/v1',
    })).toThrow(QA_BACKEND_ISOLATION_ERROR);
  });
});
