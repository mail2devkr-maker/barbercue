import { Role } from '@barbercue/shared';
import { canOpenAdminPath } from '../../../lib/admin-route-access';
import { growthAiLinksEnabled } from '../../../lib/dashboard-flags';

const loadNav = (value) => {
  const before = process.env.NEXT_PUBLIC_GROWTH_AI_ENABLED;
  if (value === undefined) delete process.env.NEXT_PUBLIC_GROWTH_AI_ENABLED;
  else process.env.NEXT_PUBLIC_GROWTH_AI_ENABLED = value;
  let nav;
  jest.isolateModules(() => {
    // jest.isolateModules needs a synchronous require to re-read the build-time flag.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nav = require('../shell/admin-nav');
  });
  if (before === undefined) delete process.env.NEXT_PUBLIC_GROWTH_AI_ENABLED;
  else process.env.NEXT_PUBLIC_GROWTH_AI_ENABLED = before;
  return nav;
};

describe('Growth AI admin entry points', () => {
  it('is off unless the flag is exactly "true"', () => {
    expect(growthAiLinksEnabled(undefined)).toBe(false);
    expect(growthAiLinksEnabled('1')).toBe(false);
    expect(growthAiLinksEnabled('TRUE')).toBe(false);
    expect(growthAiLinksEnabled('true')).toBe(true);
  });

  it('leaves the admin sidebar exactly as before while off', () => {
    const nav = loadNav(undefined);
    expect(nav.ADMIN_NAV_GROUPS.some((g) => g.id === 'GROWTH_AI')).toBe(false);
    expect(nav.ADMIN_NAV_ITEMS.some((i) => i.group === 'GROWTH_AI')).toBe(false);
  });

  it('adds Growth AI → Customer Acquisition when on', () => {
    const nav = loadNav('true');
    const group = nav.ADMIN_NAV_GROUPS.find((g) => g.id === 'GROWTH_AI');
    expect(group).toMatchObject({ label: 'Growth AI' });
    const items = nav.ADMIN_NAV_ITEMS.filter((i) => i.group === 'GROWTH_AI');
    expect(items[0]).toMatchObject({ label: 'Customer Acquisition', href: '/dashboard/admin/growth', status: 'live' });
  });

  it('lets internal admins open the page (the server decides the Growth role) and nobody else', () => {
    expect(canOpenAdminPath([Role.PLATFORM_VIEWER], '/dashboard/admin/growth')).toBe(true);
    expect(canOpenAdminPath([Role.SALON_OWNER], '/dashboard/admin/growth')).toBe(false);
    expect(canOpenAdminPath([Role.CUSTOMER], '/dashboard/admin/growth')).toBe(false);
  });
});
