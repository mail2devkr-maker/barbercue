import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { Role } from '@barbercue/shared';
import { ExportPanel } from '../../exports/ExportPanel';
import { CustomersOverview } from '../CustomersOverview';
import { AdminFiltersProvider } from '../../shell/admin-filters';
import { canOpenAdminPath } from '../../../../lib/admin-route-access';
import { adminNavFor } from '../../shell/admin-nav';
import { useAuth } from '../../../../lib/auth-context';
import { apiFetch, apiFetchBlob } from '../../../../lib/api';

jest.mock('../../../../lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('../../../../lib/api', () => ({
  apiFetch: jest.fn(),
  apiFetchBlob: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
jest.mock('../../charts/export', () => ({ downloadBlob: jest.fn() }));

const textOf = (node) => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''));
const OPTIONS = [
  { id: 'report', label: 'Customer report', description: 'no contacts', path: 'admin/exports/customers', permission: 'exportCustomerReport' },
  { id: 'contacts', label: 'Customer contact list', description: 'contacts', path: 'admin/exports/customers/contact', permission: 'exportCustomerContacts', personal: true },
];

function renderPanel(roles) {
  useAuth.mockReturnValue({ user: { roles } });
  let tree;
  act(() => { tree = TestRenderer.create(<ExportPanel title="Customer data export" options={OPTIONS} from="2026-10-01" to="2026-10-27" />); });
  return tree;
}
const buttons = (tree) => tree.root.findAll((n) => n.type === 'button');

describe('page access mirrors the server permissions', () => {
  test.each([
    [Role.PLATFORM_ADMIN, true, true],
    [Role.CO_FOUNDER, true, true],
    [Role.PLATFORM_VIEWER, true, true],
    [Role.HR_ADMIN, false, true],
    [Role.SALES_ADMIN, false, false],
    [Role.CUSTOMER, false, false],
  ])('%s: customers %s, staff %s', (role, customers, staff) => {
    expect(canOpenAdminPath([role], '/dashboard/admin/customers')).toBe(customers);
    expect(canOpenAdminPath([role], '/dashboard/admin/staff')).toBe(staff);
    const ids = adminNavFor([role]).map((i) => i.id);
    expect(ids.includes('customer-overview')).toBe(customers);
    expect(ids.includes('staff-overview')).toBe(staff);
  });
});

describe('ExportPanel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a co-founder the report but not the contact export', () => {
    const tree = renderPanel([Role.CO_FOUNDER]);
    expect(textOf(tree.root)).toContain('Customer report');
    expect(textOf(tree.root)).not.toContain('Customer contact list');
  });

  it('shows a read-only viewer no downloads at all', () => {
    const tree = renderPanel([Role.PLATFORM_VIEWER]);
    expect(buttons(tree)).toHaveLength(0);
    expect(textOf(tree.root)).toContain('Your role cannot download these files.');
  });

  it('requires an explicit confirmation before a contact download, then requests the contact route', async () => {
    apiFetchBlob.mockResolvedValue({ blob: new Blob(['x']), filename: 'f.csv' });
    const tree = renderPanel([Role.PLATFORM_ADMIN]);
    const [report, contacts] = buttons(tree);
    expect(report.props.disabled).toBe(false);
    expect(contacts.props.disabled).toBe(true);

    act(() => tree.root.findByType('input').props.onChange({ target: { checked: true } }));
    expect(buttons(tree)[1].props.disabled).toBe(false);
    await act(async () => buttons(tree)[1].props.onClick());
    expect(apiFetchBlob).toHaveBeenCalledWith('admin/exports/customers/contact?from=2026-10-01&to=2026-10-27');
    expect(textOf(tree.root)).toContain('recorded in the audit log');
  });
});

describe('CustomersOverview', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-26T20:00:00.000Z') });
    globalThis.window = { setTimeout, clearTimeout };
    globalThis.document = { getElementById: () => null };
    useAuth.mockReturnValue({ user: { roles: [Role.PLATFORM_ADMIN] } });
  });
  afterEach(() => {
    jest.useRealTimers();
    delete globalThis.window;
    delete globalThis.document;
  });

  it('lists customers by masked ID only and shows the period figures', async () => {
    apiFetch.mockImplementation((path) => {
      const url = new URL(`http://x/${path}`);
      return Promise.resolve({
        from: url.searchParams.get('from'), to: url.searchParams.get('to'), timeZone: 'Asia/Kolkata', generatedAt: 'g',
        kpis: { customersEver: 9, activeCustomers: 5, newCustomers: 3, returningCustomers: 2, completedVisits: 7, averageVisitsPerActive: 1.4, averageVisitValuePaise: 35000, repeatRatePercent: 40, noShowRatePercent: null },
        sources: [{ source: 'APP', label: 'Customer app', count: 3 }],
        categories: [{ category: 'Hair', visits: 4 }],
        customers: [{ maskedId: 'C-ABCDEF1234', firstVisitAt: '2026-10-02T05:00:00Z', lastVisitAt: '2026-10-20T05:00:00Z', completedVisits: 2, cancelled: 0, noShow: 1, serviceValuePaise: 70000, preferredCategory: 'Hair' }],
        customersTotal: 1, customersLimit: 200,
      });
    });
    let tree;
    await act(async () => {
      tree = TestRenderer.create(<AdminFiltersProvider><CustomersOverview /></AdminFiltersProvider>);
    });
    await act(async () => { jest.advanceTimersByTime(1); });

    expect(apiFetch.mock.calls[0][0]).toBe('admin/customers?from=2026-09-28&to=2026-10-27');
    const text = textOf(tree.root);
    expect(text).toContain('C-ABCDEF1234');
    expect(text).toContain('40.0%');
    expect(text).not.toMatch(/@|\+91/);
    const headers = tree.root.findAll((n) => n.type === 'th' && n.props.scope === 'col').map(textOf);
    expect(headers.join(' ')).not.toMatch(/Phone|Email|Name/i);
  });
});
