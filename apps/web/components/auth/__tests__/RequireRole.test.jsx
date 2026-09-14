import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { RequireRole } from '../RequireRole';
import { useAuth } from '../../../lib/auth-context';

jest.mock('../../../lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('../../ui/BrandLockup', () => ({ BrandLockup: () => null }));

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/dashboard/register-shop',
}));

function render(props) {
  let tree;
  act(() => {
    tree = TestRenderer.create(
      <RequireRole {...props}>
        <div>protected content</div>
      </RequireRole>,
    );
  });
  return tree;
}

// Golden-path regression (P0 register-shop incident): RequireRole is the ONLY thing that can carry
// an unauthenticated visitor's original destination (e.g. /dashboard/register-shop) through the
// login redirect in production, since web and API are on different hosts there (no server-side
// proxy short-circuit to lean on). This was traced and confirmed already correct — these tests
// exist so a future change can't silently regress it back to a bare "/login" with no continuation.
describe('RequireRole', () => {
  beforeEach(() => {
    replace.mockClear();
    globalThis.window = { location: { search: '' } };
  });

  it('preserves the shop-registration intent as ?next= when redirecting an unauthenticated visitor', () => {
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    render({ redirectTo: '/login' });
    expect(replace).toHaveBeenCalledWith('/login?next=%2Fdashboard%2Fregister-shop');
  });

  it('carries the current query string along too', () => {
    window.location.search = '?ref=demo';
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    render({ redirectTo: '/login' });
    expect(replace).toHaveBeenCalledWith('/login?next=%2Fdashboard%2Fregister-shop%3Fref%3Ddemo');
  });

  it('lets an authenticated customer straight into shop onboarding with no role restriction', () => {
    useAuth.mockReturnValue({ user: { roles: ['CUSTOMER'] }, status: 'authenticated' });
    const tree = render({ redirectTo: '/login' });
    expect(tree.toJSON()).toEqual(expect.objectContaining({ children: ['protected content'] }));
    expect(replace).not.toHaveBeenCalled();
  });

  it('never redirects an already-authorized visitor, even across a re-render (no redirect loop)', () => {
    useAuth.mockReturnValue({ user: { roles: ['CUSTOMER'] }, status: 'authenticated' });
    const tree = render({ redirectTo: '/login' });
    act(() => tree.update(
      <RequireRole redirectTo="/login"><div>protected content</div></RequireRole>,
    ));
    expect(replace).not.toHaveBeenCalled();
  });

  it('still redirects an authenticated user lacking a required role (owner-only areas stay protected)', () => {
    useAuth.mockReturnValue({ user: { roles: ['CUSTOMER'] }, status: 'authenticated' });
    render({ redirectTo: '/owner/login', roles: ['SALON_OWNER'] });
    expect(replace).toHaveBeenCalledWith('/owner/login?next=%2Fdashboard%2Fregister-shop');
  });

  it('renders nothing yet while the session is still restoring, and does not redirect prematurely', () => {
    useAuth.mockReturnValue({ user: null, status: 'loading' });
    const tree = render({ redirectTo: '/login' });
    expect(JSON.stringify(tree.toJSON())).not.toContain('protected content');
    expect(replace).not.toHaveBeenCalled();
  });
});
