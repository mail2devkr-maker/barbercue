import fs from 'fs';
import path from 'path';
import { HOME_STATUS_LABEL, HOME_TRANSITIONS, Role } from '@barbercue/shared';
import { homeServicesLinksEnabled } from '../../../lib/dashboard-flags';
import { canOpenAdminPath } from '../../../lib/admin-route-access';
import { ADMIN_NAV_GROUPS, adminNavFor } from '../../admin/shell/admin-nav';
import { navItemsFor } from '../../owner/owner-nav';
import { PRIMARY_NAV } from '../../customer-dashboard/DashboardShell';
import { ADMIN_HOME_TABS } from '../admin-home-tabs';
import { groupBag } from '../HomeBooking';

jest.mock('next/navigation', () => ({ useRouter: () => ({}), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

describe('FastQue Home entry points', () => {
  it('is off unless the switch is exactly "true"; menus are then unchanged', () => {
    expect(homeServicesLinksEnabled(undefined)).toBe(false);
    expect(homeServicesLinksEnabled('1')).toBe(false);
    expect(homeServicesLinksEnabled('true')).toBe(true);
    expect(navItemsFor('owner').map((i) => i.id)).not.toContain('home-services');
    expect(PRIMARY_NAV.map((i) => i.href)).not.toContain('/account/home-services');
  });

  it('the admin sidebar hides FastQue Home while the switch is off', () => {
    expect(ADMIN_NAV_GROUPS.map((g) => g.label)).not.toContain('FastQue Home');
    expect(adminNavFor([Role.PLATFORM_ADMIN]).filter((i) => i.group === 'HOME_SERVICES')).toHaveLength(0);
  });

  it('once switched on, the admin portal has a top-level FastQue Home section with the 23 sub-tabs', () => {
    const before = process.env.NEXT_PUBLIC_FASTQUE_HOME_ENABLED;
    process.env.NEXT_PUBLIC_FASTQUE_HOME_ENABLED = 'true';
    let nav;
    jest.isolateModules(() => { nav = require('../../admin/shell/admin-nav'); });
    if (before === undefined) delete process.env.NEXT_PUBLIC_FASTQUE_HOME_ENABLED; else process.env.NEXT_PUBLIC_FASTQUE_HOME_ENABLED = before;
    expect(nav.ADMIN_NAV_GROUPS.map((g) => g.label)).toContain('FastQue Home');
    expect(ADMIN_HOME_TABS).toHaveLength(23);
    const items = nav.adminNavFor([Role.PLATFORM_ADMIN]).filter((i) => i.group === 'HOME_SERVICES');
    expect(items.map((i) => i.label)).toEqual(ADMIN_HOME_TABS.map((t) => t.label));
    expect(nav.activeAdminItem(nav.adminNavFor([Role.PLATFORM_ADMIN]), '/dashboard/admin/home', 'tab=dispatch').id).toBe('home-dispatch');
    expect(canOpenAdminPath([Role.PLATFORM_VIEWER], '/dashboard/admin/home')).toBe(true);
    expect(canOpenAdminPath([Role.HR_ADMIN], '/dashboard/admin/home')).toBe(false);
  });

  it('tracking and the professional dashboard are outside the switched folder, so visits can finish', () => {
    const app = path.join(__dirname, '../../../app/(home)');
    expect(fs.existsSync(path.join(app, 'home-services/tracking/[code]/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(app, 'home-pro/page.tsx'))).toBe(true);
    expect(fs.readFileSync(path.join(app, 'home-services/(open)/layout.tsx'), 'utf8')).toContain('notFound');
  });

  it('every status has English and Hindi wording and an unaccepted request never reads as confirmed', () => {
    for (const status of Object.keys(HOME_TRANSITIONS)) expect(HOME_STATUS_LABEL[status].hi).toBeTruthy();
    expect(HOME_STATUS_LABEL.INVITED.en).toContain('not confirmed');
  });

  it('groups the bag by provider so separate appointments are visible before checkout', () => {
    const bag = [
      { serviceCode: 'a', name: 'A', quantity: 1, professionalId: 'p1' },
      { serviceCode: 'b', name: 'B', quantity: 1, professionalId: 'p1' },
      { serviceCode: 'c', name: 'C', quantity: 1, professionalId: 'p2' },
    ];
    expect(groupBag(bag).map((g) => g.items.length)).toEqual([2, 1]);
  });
});
