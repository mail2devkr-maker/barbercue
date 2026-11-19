import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { AdminFinance } from '../AdminFinance';
import { apiFetch } from '../../../../lib/api';

const replace = jest.fn();
let search = '';
let params = new URLSearchParams();
const stableParams = () => (params.toString() === search ? params : (params = new URLSearchParams(search)));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/dashboard/admin/finance',
  useSearchParams: () => stableParams(),
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className }) => <a href={href} className={className}>{children}</a> }));
jest.mock('../../../../lib/api', () => {
  class ApiError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  return { apiFetch: jest.fn(), apiFetchBlob: jest.fn(), ApiError };
});

const textOf = (node) => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''));
const company = { roles: { viewCompany: true, manage: true, approve: true, configure: true, bankDetails: true }, contributorId: null };
const staff = { roles: { viewCompany: false, manage: false, approve: false, configure: false, bankDetails: false }, contributorId: 'c-hr' };
const kpis = {
  totalFundsContributed: '50000.00', founderContributions: '50000.00', otherFunding: '0.00', paidPersonallyOnBehalf: '1200.00',
  totalExpensesIncurred: '6200.00', totalExpensesPaid: '4200.00', unpaidLiabilities: '2000.00', expensesThisMonth: '6200.00',
  expensesLastMonth: '0.00', periodExpensesIncurred: '6200.00', periodFundingReceived: '50000.00', availableCash: '146000.00',
  averageGrossBurn: null, averageNetBurn: null, burnMonthsUsed: 0, runway: { kind: 'INSUFFICIENT_DATA' }, pendingReimbursements: '0.00',
  reimbursementsAwaitingReview: '0.00', outstandingPayables: '2000.00', approvedUnpaidExpenses: '0.00', expensesAwaitingApproval: '799.00',
  periodNetCashFlow: '46000.00', revenueReceived: null, budgetUtilizationPercent: null,
};
const overview = {
  period: { from: '2026-11-01', to: '2026-11-18' }, generatedAt: '2026-11-18T10:00:00.000Z', kpis,
  byCategory: [{ key: 't', label: 'Technology & Product Development', amount: '6200.00', count: 2 }],
  byCity: [], byDepartment: [], byPaidBy: [], byContributorFunding: [], reimbursementsOwedByPerson: [],
  monthly: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, incurred: i === 10 ? '6200.00' : '0.00', companyCashOut: '0.00', fundingIn: '0.00' })),
};
const category = { id: 'cat-1', name: 'Technology & Product Development', department: 'Technology', isSystem: true, isActive: true, subcategories: [{ id: 'sub-1', name: 'Cloud Hosting', isSystem: true, isActive: true }] };

function route(me) {
  return (path) => {
    if (path.endsWith('/me')) return Promise.resolve(me);
    if (path.startsWith('admin/finance/overview')) return Promise.resolve(overview);
    if (path.endsWith('/categories')) return Promise.resolve([category]);
    if (path.startsWith('admin/finance/expenses?')) return Promise.resolve({ items: [], total: 0, page: 1, pageSize: 25, totalAmount: '0.00' });
    return Promise.resolve([]);
  };
}

beforeEach(() => {
  apiFetch.mockReset();
  replace.mockReset();
  search = '';
});

describe('admin finance', () => {
  it('shows every tab and real KPI figures to company finance roles', async () => {
    apiFetch.mockImplementation(route(company));
    let tree;
    await act(async () => { tree = TestRenderer.create(<AdminFinance />); });
    const tabs = tree.root.findAll((n) => n.props.role === 'tab').map(textOf);
    expect(tabs).toEqual(['Overview', 'Expenses', 'Contributions & Funding', 'Reimbursements', 'Vendors & Payments', 'Settings & Categories']);
    const text = textOf(tree.root);
    expect(text).toContain('Available cash₹1,46,000');
    expect(text).toContain('Cash runwayInsufficient data');
    expect(text).toContain('Revenue receivedNot connected');
    expect(text).toContain('Technology & Product Development');
  });

  it('gives other admin roles only their own expenses and claims', async () => {
    search = 'tab=funding';
    apiFetch.mockImplementation(route(staff));
    let tree;
    await act(async () => { tree = TestRenderer.create(<AdminFinance />); });
    const tabs = tree.root.findAll((n) => n.props.role === 'tab').map(textOf);
    expect(tabs).toEqual(['Expenses', 'Reimbursements']);
    expect(textOf(tree.root)).toContain('My expenses & claims');
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining('admin/finance/overview'));
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining('admin/finance/funding'));
  });

  it('warns about a possible duplicate and saves only when confirmed', async () => {
    // The form opens in the shared Dialog, whose focus handling only needs these from `document`.
    global.document = { activeElement: null, addEventListener() {}, removeEventListener() {} };
    search = 'tab=expenses';
    const { ApiError } = jest.requireMock('../../../../lib/api');
    let posts = 0;
    apiFetch.mockImplementation((path, opts) => {
      if (opts?.method === 'POST' && path === 'admin/finance/expenses') {
        posts += 1;
        const body = JSON.parse(opts.body);
        if (!body.confirmDuplicate)
          return Promise.reject(new ApiError('FINANCE_DUPLICATE_SUSPECTED', 'Looks like a duplicate', { candidates: [{ id: 'e1', number: 'EXP-000001', expenseDate: '2026-11-18', amount: '1000.00', description: 'Hosting', status: 'SUBMITTED' }] }));
        return Promise.resolve({ id: 'e2' });
      }
      if (path === 'admin/finance/expenses/e2')
        return Promise.resolve({
          id: 'e2', number: 'EXP-000002', expenseDate: '2026-11-18', category: { id: 'cat-1', name: category.name }, subcategory: null,
          customSubcategory: null, description: 'Hosting for November', amount: '1000.00', taxAmount: '0.00', currency: 'INR', vendor: null,
          department: null, city: null, project: null, reimbursementRequired: false, isRecurring: false, notes: null, status: 'DRAFT',
          paidAmount: '0.00', paidBy: [], lastPaidOn: null, attachmentCount: 0, createdBy: { id: 'u', name: 'Admin' }, approvedBy: null,
          approvedAt: null, reviewNote: null, createdAt: '2026-11-18T10:00:00.000Z',
          can: { edit: true, submit: true, review: false, cancel: true, pay: true, delete: true }, payments: [], attachments: [],
        });
      return route(company)(path);
    });
    let tree;
    await act(async () => { tree = TestRenderer.create(<AdminFinance />); });
    const addButton = tree.root.findAll((n) => n.type === 'button' && textOf(n).includes('Add expense'))[0];
    await act(async () => addButton.props.onClick());
    const input = (id) => tree.root.find((n) => n.props.id === id);
    await act(async () => input('ef-amount').props.onChange({ target: { value: '1000' } }));
    await act(async () => input('ef-cat').props.onChange({ target: { value: 'cat-1' } }));
    await act(async () => input('ef-desc').props.onChange({ target: { value: 'Hosting for November' } }));
    const form = tree.root.findByType('form');
    await act(async () => form.props.onSubmit({ preventDefault() {} }));
    expect(textOf(tree.root)).toContain('EXP-000001');
    const confirm = tree.root.findAll((n) => n.type === 'button' && textOf(n).includes('save anyway'))[0];
    await act(async () => confirm.props.onClick());
    expect(posts).toBe(2);
    const lastBody = JSON.parse(apiFetch.mock.calls.filter(([p, o]) => p === 'admin/finance/expenses' && o?.method === 'POST').pop()[1].body);
    expect(lastBody).toMatchObject({ confirmDuplicate: true, amount: '1000', categoryId: 'cat-1' });
    // After saving, the new draft opens with its next step.
    expect(textOf(tree.root)).toContain('Submit for approval');
    delete global.document;
  });
});
