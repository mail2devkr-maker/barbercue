import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SessionAudience, UserStatus } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** FastQue Finance end to end, on a DISPOSABLE database (name ending in _e2e). */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const parsed = (() => {
  try {
    return new URL(DATABASE_URL);
  } catch {
    return null;
  }
})();
const DISPOSABLE =
  !!parsed &&
  ['localhost', '127.0.0.1'].includes(parsed.hostname) &&
  parsed.pathname.endsWith('_e2e');
const maybe = DISPOSABLE ? describe : describe.skip;

// Smallest valid PNG (1x1).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

maybe('Finance (e2e, disposable database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  // Amounts unique to this run, so reruns on the same disposable database never look like duplicates.
  const offset = (parseInt(run, 16) % 9000) + 1;
  const claimAmount = 1000 + offset;
  const bigAmount = 5000 + offset;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const base = '/api/v1/admin/finance';
  const as = (who: string) => ({
    get: (p: string) => request(app.getHttpServer()).get(`${base}/${p}`).set('Authorization', `Bearer ${tok[who]}`),
    post: (p: string, body?: object) =>
      request(app.getHttpServer()).post(`${base}/${p}`).set('Authorization', `Bearer ${tok[who]}`).send(body ?? {}),
  });
  /** A date in the current month (India), so "this month" figures include it. */
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
      })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);
    const user = async (label: string, roles: Role[]) => {
      const u = await prisma.user.create({
        data: { email: `fin-${run}-${label}@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE, phone: null },
      });
      for (const role of roles) await prisma.userRole.create({ data: { userId: u.id, role, salonId: null } });
      tok[label] = tokens.signAccessToken(u.id, roles, SessionAudience.ADMIN);
      ids[`user_${label}`] = u.id;
    };
    await user('admin', [Role.PLATFORM_ADMIN]);
    await user('cofounder', [Role.CO_FOUNDER]);
    await user('hr', [Role.HR_ADMIN]);
    await user('sales', [Role.SALES_ADMIN]);
    const categories = await prisma.financeCategory.findFirstOrThrow({
      where: { parentId: null, normalizedName: 'technology product development' },
      include: { subcategories: { where: { normalizedName: 'cloud hosting' } } },
    });
    ids.tech = categories.id;
    ids.hosting = categories.subcategories[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('seeds FastQue categories and limits company figures to finance roles', async () => {
    const cats = await as('hr').get('categories').expect(200);
    expect(cats.body.length).toBeGreaterThanOrEqual(10);
    await as('hr').get('overview').expect(403);
    await as('hr').get('funding').expect(403);
    await as('sales').get('accounts').expect(403);
    const me = await as('hr').get('me').expect(200);
    expect(me.body.roles).toMatchObject({ viewCompany: false, manage: false });
  });

  it('sets up a company account, a founder and funding (never revenue)', async () => {
    const acc = await as('admin').post('accounts', { name: `Current ${run}`, type: 'COMPANY_BANK', openingBalance: '100000', openingBalanceDate: day }).expect(201);
    ids.account = acc.body.id;
    // Co-founders may record funding but not configure accounts.
    await as('cofounder').post('accounts', { name: 'Petty cash', type: 'COMPANY_CASH', openingBalanceDate: day }).expect(403);
    const founder = await as('cofounder').post('contributors', { name: `Founder ${run}`, type: 'FOUNDER', userEmail: `fin-${run}-cofounder@example.test` }).expect(201);
    ids.founder = founder.body.id;
    await as('admin').post('contributors', { name: 'Dup link', type: 'OTHER', userEmail: `fin-${run}-cofounder@example.test` }).expect(400);
    const req = randomUUID();
    const f1 = await as('cofounder').post('funding', { contributorId: ids.founder, kind: 'CONTRIBUTION', classification: 'SHARE_CAPITAL', date: day, amount: '50000', accountId: ids.account, method: 'BANK_TRANSFER', clientRequestId: req }).expect(201);
    // Idempotent retry returns the same record instead of a second deposit.
    const f2 = await as('cofounder').post('funding', { contributorId: ids.founder, kind: 'CONTRIBUTION', classification: 'SHARE_CAPITAL', date: day, amount: '50000', accountId: ids.account, method: 'BANK_TRANSFER', clientRequestId: req }).expect(201);
    expect(f2.body.id).toBe(f1.body.id);
  });

  it('lets a staff member claim what they paid, without double counting', async () => {
    const created = await as('hr').post('expenses', { expenseDate: day, categoryId: ids.tech, subcategoryId: ids.hosting, description: `Hosting ${run}`, amount: String(claimAmount), paidByMe: true }).expect(201);
    ids.hrExpense = created.body.id;
    // Same amount, date and category → possible duplicate.
    const dup = await as('hr').post('expenses', { expenseDate: day, categoryId: ids.tech, description: `Hosting again ${run}`, amount: String(claimAmount) }).expect(409);
    expect(dup.body.error.code).toBe('FINANCE_DUPLICATE_SUSPECTED');
    const forced = await as('hr').post('expenses', { expenseDate: day, categoryId: ids.tech, description: `Hosting again ${run}`, amount: String(claimAmount), confirmDuplicate: true }).expect(201);
    await as('hr').post(`expenses/${forced.body.id}/cancel`, { reason: 'Entered twice' }).expect(201);

    await as('hr').post(`expenses/${ids.hrExpense}/submit`).expect(201);
    const mine = await as('hr').get('expenses').expect(200);
    expect(mine.body.items.every((e: { createdBy: { id: string } }) => e.createdBy.id === ids.user_hr)).toBe(true);
    await as('sales').get(`expenses/${ids.hrExpense}`).expect(404);

    const claims = await as('hr').get('reimbursements').expect(200);
    expect(claims.body).toHaveLength(1);
    ids.claim = claims.body[0].id;
    // A second claim on the same payment is refused.
    const dupClaim = await as('hr').post('reimbursements', { expensePaymentId: claims.body[0].expensePaymentId, amountRequested: String(claimAmount) }).expect(409);
    expect(dupClaim.body.error.code).toBe('FINANCE_DUPLICATE_CLAIM');
    await as('hr').post(`expenses/${ids.hrExpense}/review`, { action: 'APPROVE' }).expect(403);
  });

  it('approves, then reimburses partially and fully; payouts settle, never re-expense', async () => {
    const approved = await as('cofounder').post(`expenses/${ids.hrExpense}/review`, { action: 'APPROVE' }).expect(201);
    expect(approved.body.id).toBe(ids.hrExpense);
    const e = await as('admin').get(`expenses/${ids.hrExpense}`).expect(200);
    expect(e.body.status).toBe('PAID'); // paid personally — no company cash moved
    await as('cofounder').post(`reimbursements/${ids.claim}/review`, { action: 'APPROVE', amountApproved: String(claimAmount) }).expect(201);
    await as('admin').post(`reimbursements/${ids.claim}/payouts`, { amount: '400', paidOn: day, accountId: ids.account, method: 'UPI' }).expect(201);
    let claim = (await as('hr').get('reimbursements').expect(200)).body[0];
    expect(claim).toMatchObject({ status: 'PARTIALLY_REIMBURSED', amountReimbursed: '400.00', remaining: `${claimAmount - 400}.00` });
    const over = await as('admin').post(`reimbursements/${ids.claim}/payouts`, { amount: String(claimAmount - 300), paidOn: day, accountId: ids.account, method: 'UPI' }).expect(409);
    expect(over.body.error.code).toBe('FINANCE_OVERPAYMENT');
    await as('admin').post(`reimbursements/${ids.claim}/payouts`, { amount: String(claimAmount - 400), paidOn: day, accountId: ids.account, method: 'UPI' }).expect(201);
    claim = (await as('hr').get('reimbursements').expect(200)).body[0];
    expect(claim.status).toBe('FULLY_REIMBURSED');
    const hrContributor = (await as('hr').get('me').expect(200)).body.contributorId;
    const ledger = await as('hr').get(`contributors/${hrContributor}/ledger`).expect(200);
    expect(ledger.body.totals).toMatchObject({ paidPersonally: `${claimAmount}.00`, reimbursed: `${claimAmount}.00`, reimbursementOutstanding: '0.00', fundedIntoCompany: '0.00' });
  });

  it('keeps approval separate from payment and blocks overpayment, even concurrently', async () => {
    const created = await as('admin').post('expenses', { expenseDate: day, categoryId: ids.tech, description: `AI tools ${run}`, amount: String(bigAmount), vendorId: undefined, city: 'Patna', department: 'Technology' }).expect(201);
    ids.companyExpense = created.body.id;
    await as('admin').post(`expenses/${ids.companyExpense}/submit`).expect(201);
    await as('admin').post(`expenses/${ids.companyExpense}/review`, { action: 'APPROVE', note: 'ok' }).expect(201); // platform admin may self-approve (audited)
    let e = (await as('admin').get(`expenses/${ids.companyExpense}`).expect(200)).body;
    expect(e.status).toBe('APPROVED');
    await as('admin').post(`expenses/${ids.companyExpense}/payments`, { amount: '3000', paidOn: day, payerType: 'COMPANY_ACCOUNT', accountId: ids.account, method: 'BANK_TRANSFER' }).expect(201);
    const pay = () => as('admin').post(`expenses/${ids.companyExpense}/payments`, { amount: String(bigAmount - 3000), paidOn: day, payerType: 'COMPANY_ACCOUNT', accountId: ids.account, method: 'UPI' });
    const results = await Promise.all([pay(), pay()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    e = (await as('admin').get(`expenses/${ids.companyExpense}`).expect(200)).body;
    expect(e).toMatchObject({ status: 'PAID', paidAmount: `${bigAmount}.00` });
    const second = e.payments.find((p: { amount: string; voided: boolean }) => p.amount === `${bigAmount - 3000}.00` && !p.voided);
    await as('admin').post(`payments/${second.id}/void`, { reason: 'Bounced' }).expect(201);
    e = (await as('admin').get(`expenses/${ids.companyExpense}`).expect(200)).body;
    expect(e).toMatchObject({ status: 'PARTIALLY_PAID', paidAmount: '3000.00' });
    const audit = (await as('admin').get(`expenses/${ids.companyExpense}/audit`).expect(200)).body;
    expect(audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['created', 'submitted', 'approved', 'expense payment voided']));
  });

  it('stops a co-founder approving their own expense', async () => {
    const created = await as('cofounder').post('expenses', { expenseDate: day, categoryId: ids.tech, description: `Domain ${run}`, amount: String(700 + offset) }).expect(201);
    await as('cofounder').post(`expenses/${created.body.id}/submit`).expect(201);
    const self = await as('cofounder').post(`expenses/${created.body.id}/review`, { action: 'APPROVE' }).expect(403);
    expect(self.body.error.code).toBe('FINANCE_SELF_APPROVAL');
  });

  it('calculates the overview from actual transactions', async () => {
    const o = (await as('cofounder').get('overview').expect(200)).body;
    // Cash = 100000 opening + 50000 funding − the reimbursement payouts − 3000 company payment.
    const account = (await as('admin').get('accounts').expect(200)).body.find((a: { id: string }) => a.id === ids.account);
    expect(account.balance).toBe(`${150000 - claimAmount - 3000}.00`);
    expect(Number(o.kpis.availableCash)).toBeGreaterThanOrEqual(150000 - claimAmount - 3000);
    expect(Number(o.kpis.totalFundsContributed)).toBeGreaterThanOrEqual(50000);
    expect(o.kpis.revenueReceived).toBeNull();
    expect(Number(o.kpis.expensesAwaitingApproval)).toBeGreaterThanOrEqual(799);
    expect(o.byCity.some((c: { label: string }) => c.label === 'Patna')).toBe(true);
  });

  it('stores receipts privately and rejects duplicates', async () => {
    const up = () =>
      request(app.getHttpServer())
        .post(`${base}/expenses/${ids.hrExpense}/attachments`)
        .set('Authorization', `Bearer ${tok.hr}`)
        .attach('file', Buffer.concat([PNG, Buffer.from(run)]), { filename: 'receipt.png', contentType: 'image/png' });
    const first = await up().expect(201);
    const again = await up().expect(409);
    expect(again.body.error.code).toBe('FINANCE_DUPLICATE_ATTACHMENT');
    const file = await as('hr').get(`attachments/${first.body.id}`).expect(200);
    expect(file.headers['content-type']).toContain('image/png');
    await as('sales').get(`attachments/${first.body.id}`).expect(404);
    await request(app.getHttpServer())
      .post(`${base}/expenses/${ids.hrExpense}/attachments`)
      .set('Authorization', `Bearer ${tok.hr}`)
      .attach('file', Buffer.from('not really a pdf'), { filename: 'fake.pdf', contentType: 'application/pdf' })
      .expect(400);
  });

  it('never deletes money rows or audit history', async () => {
    await expect(prisma.$executeRawUnsafe('DELETE FROM "finance_audit_events"')).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('UPDATE "finance_audit_events" SET "note" = \'x\'')).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM "finance_expense_payments"')).rejects.toThrow(/never deleted/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM "finance_funding"')).rejects.toThrow(/never deleted/);
  });
});
