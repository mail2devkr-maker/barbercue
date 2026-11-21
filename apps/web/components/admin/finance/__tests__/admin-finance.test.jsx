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
  byType: [], byCity: [], byDepartment: [], byPaidBy: [], byContributorFunding: [], reimbursementsOwedByPerson: [],
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
    // "Who spent the money?" is required.
    await act(async () => input('ef-payer').props.onChange({ target: { value: 'unpaid' } }));
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

  it('records who spent the money, including a person and how it is treated', async () => {
    search = 'tab=expenses';
    global.document = { activeElement: null, addEventListener() {}, removeEventListener() {} };
    const founder = { id: 'c-founder', name: 'Nitesh', type: 'FOUNDER', userId: null, userEmail: null, email: null, phone: null, notes: null, isActive: true };
    let body = null;
    apiFetch.mockImplementation((path, opts) => {
      if (opts?.method === 'POST' && path === 'admin/finance/expenses') {
        body = JSON.parse(opts.body);
        return Promise.reject(new Error('stop here'));
      }
      if (path.endsWith('/contributors')) return Promise.resolve([founder]);
      return route(company)(path);
    });
    let tree;
    await act(async () => { tree = TestRenderer.create(<AdminFinance />); });
    const addButton = tree.root.findAll((n) => n.type === 'button' && textOf(n).includes('Add expense'))[0];
    await act(async () => addButton.props.onClick());
    const input = (id) => tree.root.find((n) => n.props.id === id);
    const payerOptions = input('ef-payer').findAllByType('option').map(textOf);
    expect(payerOptions).toEqual(expect.arrayContaining(['Nitesh (Founder)', '+ Add a new person…', 'Not paid yet (a bill to pay later)']));
    await act(async () => input('ef-amount').props.onChange({ target: { value: '799' } }));
    await act(async () => input('ef-cat').props.onChange({ target: { value: 'cat-1' } }));
    await act(async () => input('ef-desc').props.onChange({ target: { value: 'Domain renewal' } }));
    await act(async () => input('ef-payer').props.onChange({ target: { value: 'person:c-founder' } }));
    await act(async () => input('ef-treat').props.onChange({ target: { value: 'FOUNDER_LOAN' } }));
    await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(body.paidBy).toMatchObject({ payerType: 'PERSON', contributorId: 'c-founder', personalTreatment: 'FOUNDER_LOAN' });
    expect(body.paidByMe).toBeUndefined();
    expect(body.reimbursementRequired).toBe(false);
    delete global.document;
  });

  it('records a new expense as a company expense by default, and as a claim only when paid personally', async () => {
    search = 'tab=expenses';
    global.document = { activeElement: null, addEventListener() {}, removeEventListener() {} };
    const bodies = [];
    apiFetch.mockImplementation((path, opts) => {
      if (opts?.method === 'POST' && path === 'admin/finance/expenses') {
        bodies.push(JSON.parse(opts.body));
        return Promise.reject(new Error('stop here'));
      }
      return route(staff)(path);
    });
    let tree;
    await act(async () => { tree = TestRenderer.create(<AdminFinance />); });
    const addButton = tree.root.findAll((n) => n.type === 'button' && textOf(n).includes('Add expense'))[0];
    await act(async () => addButton.props.onClick());
    const input = (id) => tree.root.find((n) => n.props.id === id);
    expect(input('ef-type').props.value).toBe('COMPANY');
    // A company expense offers no "reimburse me" choice.
    expect(input('ef-payer').findAllByType('option').map(textOf).join(' ')).not.toContain('reimburse me');
    await act(async () => input('ef-amount').props.onChange({ target: { value: '1500' } }));
    await act(async () => input('ef-cat').props.onChange({ target: { value: 'cat-1' } }));
    await act(async () => input('ef-desc').props.onChange({ target: { value: 'Cloud hosting for November' } }));
    await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(bodies[0]).toMatchObject({ categoryId: 'cat-1', reimbursementRequired: false });
    expect(bodies[0].paidByMe).toBeUndefined();
    expect(bodies[0].paidBy).toBeUndefined();
    // Paid from my own pocket: now it is a reimbursement claim.
    await act(async () => input('ef-type').props.onChange({ target: { value: 'REIMBURSEMENT' } }));
    expect(input('ef-payer').props.value).toBe('me');
    await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(bodies[1]).toMatchObject({ categoryId: 'cat-1', reimbursementRequired: true, paidByMe: true });
    delete global.document;
  });

  it('filters the list by type and edits a claim into a company expense with another category', async () => {
    search = 'tab=expenses';
    global.document = { activeElement: null, addEventListener() {}, removeEventListener() {} };
    const marketing = { id: 'cat-2', name: 'Marketing & Customer Acquisition', department: 'Marketing', isSystem: true, isActive: true, subcategories: [] };
    const item = {
      id: 'e9', number: 'EXP-000009', expenseDate: '2026-11-18', category: { id: 'cat-1', name: category.name }, subcategory: null,
      customSubcategory: null, description: 'QR posters', amount: '600.00', taxAmount: '0.00', currency: 'INR', vendor: null,
      department: null, city: null, project: null, reimbursementRequired: true, isRecurring: false, notes: null, status: 'SUBMITTED',
      paidAmount: '600.00', paidBy: ['HR person'], lastPaidOn: '2026-11-18', attachmentCount: 0, createdBy: { id: 'u', name: 'HR person' },
      approvedBy: null, approvedAt: null, reviewNote: null, createdAt: '2026-11-18T10:00:00.000Z',
      can: { edit: true, reclassify: false, submit: false, review: false, cancel: false, pay: false, delete: false },
      payments: [{ id: 'p9', amount: '600.00', paidOn: '2026-11-18', payerType: 'PERSON', account: null, contributor: { id: 'c-hr', name: 'HR person' }, personalTreatment: 'REIMBURSABLE', method: 'OTHER', reference: null, voided: false, voidReason: null, reimbursementId: 'r9' }],
      attachments: [],
    };
    let patched = null;
    apiFetch.mockImplementation((path, opts) => {
      if (path.endsWith('/categories')) return Promise.resolve([category, marketing]);
      if (path.startsWith('admin/finance/expenses?')) return Promise.resolve({ items: [item], total: 1, page: 1, pageSize: 25, totalAmount: '600.00' });
      if (path === 'admin/finance/expenses/e9' && opts?.method === 'PATCH') {
        patched = JSON.parse(opts.body);
        return Promise.resolve({ id: 'e9' });
      }
      if (path === 'admin/finance/expenses/e9') return Promise.resolve(item);
      return route(staff)(path);
    });
    let tree;
    await act(async () => { tree = TestRenderer.create(<AdminFinance />); });
    const input = (id) => tree.root.find((n) => n.props.id === id);
    expect(textOf(tree.root)).toContain('Reimbursement claim');
    await act(async () => input('fx-type').props.onChange({ target: { value: 'REIMBURSEMENT' } }));
    expect(apiFetch.mock.calls.some(([p]) => p.startsWith('admin/finance/expenses?') && p.includes('type=REIMBURSEMENT'))).toBe(true);

    const row = tree.root.findAll((n) => n.type === 'button' && textOf(n) === 'QR posters')[0];
    await act(async () => row.props.onClick());
    const edit = tree.root.findAll((n) => n.type === 'button' && textOf(n) === 'Edit')[0];
    await act(async () => edit.props.onClick());
    expect(input('ef-type').props.value).toBe('REIMBURSEMENT');
    await act(async () => input('ef-type').props.onChange({ target: { value: 'COMPANY' } }));
    await act(async () => input('ef-cat').props.onChange({ target: { value: 'cat-2' } }));
    // The user is told what happens to the personal payment.
    expect(textOf(tree.root)).toContain('The personal payment by HR person will be voided');
    await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(patched).toMatchObject({ categoryId: 'cat-2', reimbursementRequired: false });
    delete global.document;
  });

  it('lets a finance manager reclassify an approved expense with its money locked', async () => {
    search = 'tab=expenses';
    global.document = { activeElement: null, addEventListener() {}, removeEventListener() {} };
    const item = {
      id: 'e7', number: 'EXP-000007', expenseDate: '2026-11-18', category: { id: 'cat-1', name: category.name }, subcategory: null,
      customSubcategory: null, description: 'Meta ads', amount: '900.00', taxAmount: '0.00', currency: 'INR', vendor: null,
      department: null, city: null, project: null, reimbursementRequired: false, isRecurring: false, notes: null, status: 'PAID',
      paidAmount: '900.00', paidBy: ['Company · Current'], lastPaidOn: '2026-11-18', attachmentCount: 0, createdBy: { id: 'u', name: 'Admin' },
      approvedBy: null, approvedAt: null, reviewNote: null, createdAt: '2026-11-18T10:00:00.000Z',
      can: { edit: false, reclassify: true, submit: false, review: false, cancel: false, pay: false, delete: false },
      payments: [], attachments: [],
    };
    apiFetch.mockImplementation((path) => {
      if (path.startsWith('admin/finance/expenses?')) return Promise.resolve({ items: [item], total: 1, page: 1, pageSize: 25, totalAmount: '900.00' });
      if (path === 'admin/finance/expenses/e7') return Promise.resolve(item);
      return route(company)(path);
    });
    let tree;
    await act(async () => { tree = TestRenderer.create(<AdminFinance />); });
    const input = (id) => tree.root.find((n) => n.props.id === id);
    await act(async () => tree.root.findAll((n) => n.type === 'button' && textOf(n) === 'Meta ads')[0].props.onClick());
    const reclassify = tree.root.findAll((n) => n.type === 'button' && textOf(n) === 'Change category or type')[0];
    await act(async () => reclassify.props.onClick());
    expect(input('ef-amount').props.disabled).toBe(true);
    expect(input('ef-desc').props.disabled).toBe(true);
    expect(input('ef-cat').props.disabled).toBeFalsy();
    expect(textOf(tree.root)).toContain('Reclassify EXP-000007');
    delete global.document;
  });
});
