import { safeNextPath, withNextParam } from '../safe-next-path';

// Golden-path regression (P0 register-shop incident): these two functions are what carries
// "?next=/dashboard/register-shop" across a login redirect. They were NOT the bug (traced and
// confirmed correct by inspection), but they had zero test coverage before this — the one thing
// standing between a customer's shop-registration intent and an open-redirect vulnerability
// deserves its own tests regardless of where the actual regression turned out to be.
describe('safeNextPath', () => {
  it('accepts the real shop-registration continuation path', () => {
    expect(safeNextPath('/dashboard/register-shop')).toBe('/dashboard/register-shop');
  });

  it('preserves a query string on the internal path', () => {
    expect(safeNextPath('/dashboard/register-shop?step=2')).toBe('/dashboard/register-shop?step=2');
  });

  it('rejects an absolute external URL (open-redirect)', () => {
    expect(safeNextPath('https://evil.example/login')).toBeNull();
  });

  it('rejects a protocol-relative URL (browsers treat these as external)', () => {
    expect(safeNextPath('//evil.example/login')).toBeNull();
  });

  it('rejects a backslash variant some parsers normalise to protocol-relative', () => {
    expect(safeNextPath('/\\evil.example')).toBeNull();
  });

  it('rejects a javascript: URL', () => {
    expect(safeNextPath('javascript:alert(1)')).toBeNull();
  });

  it('rejects a value not starting with a single slash', () => {
    expect(safeNextPath('dashboard/register-shop')).toBeNull();
  });

  it('rejects control characters that could split a header', () => {
    expect(safeNextPath('/dashboard%0d%0aSet-Cookie:x')).toBe('/dashboard%0d%0aSet-Cookie:x');
    // eslint-disable-next-line no-control-regex
    expect(safeNextPath('/dashboard\r\nSet-Cookie:x')).toBeNull();
  });

  it('returns null for empty/missing input', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath('')).toBeNull();
  });
});

describe('withNextParam', () => {
  it('appends the shop-registration path as an encoded ?next= on the login route', () => {
    expect(withNextParam('/login', '/dashboard/register-shop')).toBe(
      '/login?next=%2Fdashboard%2Fregister-shop',
    );
  });

  it('uses & when the login path already has a query string', () => {
    expect(withNextParam('/login?ref=demo', '/dashboard/register-shop')).toBe(
      '/login?ref=demo&next=%2Fdashboard%2Fregister-shop',
    );
  });

  it('drops an unsafe next value rather than ever building an open redirect', () => {
    expect(withNextParam('/login', 'https://evil.example')).toBe('/login');
  });

  it('drops a bare "/" next value (nothing worth returning to)', () => {
    expect(withNextParam('/login', '/')).toBe('/login');
  });
});
