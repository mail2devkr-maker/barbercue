import { randomBytes, randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SessionAudience, UserStatus } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';

// Read when AppModule is compiled in beforeAll (the payment-provider factory) and per request.
process.env.WORK_MARKETPLACE_ENABLED = 'true';
process.env.WORK_PAYMENT_PROVIDER = 'manual_bank';
process.env.WORK_MANUAL_BANK_ACCOUNT_NAME = 'DEMO COMPANY PRIVATE LIMITED';
process.env.WORK_MANUAL_BANK_ACCOUNT_NUMBER = '000111222333444';
process.env.WORK_MANUAL_BANK_IFSC = 'DEMO0001234';
process.env.WORK_MANUAL_BANK_BANK_NAME = 'Demo Bank';
process.env.WORK_PLATFORM_FEE_BPS = '1000';
process.env.JWT_ACCESS_SECRET ??= 'work-e2e-only-jwt-secret-not-production';
process.env.TOTP_ENCRYPTION_KEY ??= 'work-e2e-only-encryption-secret-not-production';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
let disposable = false;
try {
  const u = new URL(DATABASE_URL);
  const db = decodeURIComponent(u.pathname.replace(/^\//, '').split('/')[0] ?? '');
  disposable = ['127.0.0.1', 'localhost'].includes(u.hostname) && ['work_marketplace_ci', 'owner_ops_chain'].includes(db);
} catch {
  disposable = false;
}
const maybe = disposable ? describe : describe.skip;

const PAY = 50_000; // ₹500
const FEE = 5_000; // 10%
const BANK_A = '123456789012';
const BANK_B = '998877665544';

/**
 * FastQue Work with WORK_PAYMENT_PROVIDER=manual_bank: employers pay the company account by NEFT,
 * a platform admin confirms the transfer with its UTR, payouts are exported for NEFT and settled by
 * an admin with the UTR. Same settlement path, ledger and audit trail as a provider webhook.
 * Demo data only, against the real AppModule and a disposable PostgreSQL database.
 */
maybe('FastQue Work manual bank transfer (real AppModule, disposable PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  // Bank UTRs are unique for ever, so every run uses its own (the suite runs twice on one database).
  const utr = (n: string) => `DEMO${run.toUpperCase()}${n}`;
  const t: Record<string, string> = {};
  const uid: Record<string, string> = {};

  const api = (method: 'get' | 'post' | 'put', path: string, who?: string, key?: string) => {
    const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
    if (who) req.set('Authorization', `Bearer ${t[who]}`);
    if (key) req.set('Idempotency-Key', key);
    return req;
  };

  async function user(label: string, roles: Role[], audience: SessionAudience) {
    const u = await prisma.user.create({
      data: { phone: `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, phoneVerifiedAt: new Date(), status: UserStatus.ACTIVE, email: `work-mb-${run}-${label}@example.test` },
    });
    uid[label] = u.id;
    t[label] = tokens.signAccessToken(u.id, roles, audience);
  }

  const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);

  const org = {
    legalName: 'Demo Manual Bank Services Private Limited',
    displayName: `Demo Manual Bank ${run}`,
    orgType: 'MARKETING_AGENCY',
    gstin: '09AAACD1234A1Z5',
    registeredAddress: 'Demo address, Knowledge Park II, Greater Noida',
    city: 'Greater Noida',
    contactName: 'Demo Contact',
    contactPhone: '+919822222222',
    contactEmail: 'demo-mb@example.test',
  };

  const job = (over: Record<string, unknown> = {}) => ({
    categorySlug: 'merchant-onboarding',
    title: `NEFT demo visits ${run}`,
    description: 'DEMO DATA. Visit assigned salons, explain the FastQue app, obtain owner consent and register interested salons.',
    locationType: 'ON_SITE',
    addressLine: 'Pari Chowk area, Greater Noida',
    city: 'Greater Noida',
    positions: 2,
    startsAt: new Date(Date.now() + 40 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    payType: 'PER_TASK',
    payPerWorkerPaise: PAY,
    hiringMode: 'INSTANT_ACCEPT',
    requiresCheckIn: true,
    requiredSkills: ['hindi'],
    checklist: [
      { id: 'consent', label: 'Obtain the owner’s consent', kind: 'CONFIRM' },
      { id: 'shop-phone', label: 'Salon contact number', kind: 'TEXT', uniqueAcrossJob: true },
      { id: 'storefront', label: 'Photo of the storefront', kind: 'PHOTO' },
    ],
    completionCriteria: 'Owner consent recorded, contact captured and a storefront photo uploaded.',
    cancellationTerms: { employerCancelAfterArrivalPaise: 25_000, employerLateCancelPaise: 0, workerLateCancelHours: 2 },
    ...over,
  });

  const profile = (name: string, extra: Record<string, unknown> = {}) => ({
    fullName: name,
    workerType: 'COLLEGE_STUDENT',
    dateOfBirth: '2003-04-12',
    city: 'Greater Noida',
    skills: ['hindi', 'sales'],
    languages: ['Hindi', 'English'],
    ...extra,
  });

  async function doWork(label: string, assignmentId: string, code: string, phone: string) {
    await api('post', `work/assignments/${assignmentId}/check-in`, label).send({ method: 'QR_CODE', code }).expect(200);
    await api('put', `work/assignments/${assignmentId}/responses/consent`, label).send({ confirmed: true }).expect(200);
    await api('put', `work/assignments/${assignmentId}/responses/shop-phone`, label).send({ text: phone }).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/work/assignments/${assignmentId}/evidence/storefront`).set('Authorization', `Bearer ${t[label]}`).attach('file', png(), 'storefront.png').expect(201);
    await api('post', `work/assignments/${assignmentId}/submit`, label).expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    await user('employer', [Role.CUSTOMER], SessionAudience.CUSTOMER);
    await user('admin', [Role.PLATFORM_ADMIN], SessionAudience.ADMIN);
    await user('viewer', [Role.PLATFORM_VIEWER], SessionAudience.ADMIN);
    await user('wa', [Role.CUSTOMER], SessionAudience.CUSTOMER);
    await user('wb', [Role.CUSTOMER], SessionAudience.CUSTOMER);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('funds by confirmed NEFT, pays workers by exported NEFT, and keeps the ledger balanced', async () => {
    const cfg = await api('get', 'work/admin/payments/config', 'viewer').expect(200);
    expect(cfg.body).toEqual({ provider: 'manual_bank', sandbox: false, payoutMethod: 'BANK' });

    // ---- verified business, job awaiting funding
    const created = await api('post', 'work/orgs', 'employer').send(org).expect(201);
    const orgId = created.body.id as string;
    await api('post', `work/orgs/${orgId}/submit`, 'employer').expect(200);
    await api('post', `work/admin/orgs/${orgId}/review`, 'admin').send({ decision: 'VERIFY' }).expect(200);
    const draft = await api('post', `work/orgs/${orgId}/jobs`, 'employer').send(job()).expect(201);
    const jobId = draft.body.id as string;
    const published = await api('post', `work/orgs/${orgId}/jobs/${jobId}/publish`, 'employer').send({ version: draft.body.version }).expect(200);
    expect(published.body.status).toBe('FUNDING_REQUIRED');

    // ---- payment order shows the company account and the reference to quote
    const funding = await api('post', `work/orgs/${orgId}/jobs/${jobId}/fund`, 'employer', `fund-${randomUUID()}`).send({ version: published.body.version }).expect(201);
    const total = 2 * (PAY + FEE);
    expect(funding.body).toMatchObject({ status: 'CREATED', amountPaise: total, provider: 'manual_bank', sandbox: false });
    expect(funding.body.providerOrderId).toMatch(/^FQW[0-9A-F]{12}$/);
    expect(funding.body.manualBank).toEqual({
      accountName: 'DEMO COMPANY PRIVATE LIMITED',
      accountNumber: '000111222333444',
      ifsc: 'DEMO0001234',
      bankName: 'Demo Bank',
      reference: funding.body.providerOrderId,
    });
    const fundingId = funding.body.id as string;

    // Nothing but an admin's confirmation can open the job.
    expect((await api('post', `work/sandbox/fundings/${fundingId}/complete`, 'employer').send({ outcome: 'SUCCEEDED' }).expect(404)).body.error.code).toBe('WORK_SANDBOX_DISABLED');
    expect((await api('post', 'work/payments/webhook').set('x-work-signature', 'a'.repeat(64)).set('x-work-timestamp', String(Math.floor(Date.now() / 1000))).send({ eventId: 'evt_forged', type: 'funding.succeeded', reference: funding.body.providerOrderId, amountPaise: total, createdAt: Math.floor(Date.now() / 1000) }).expect(401)).body.error.code).toBe('WORK_WEBHOOK_SIGNATURE_INVALID');
    await api('post', `work/admin/fundings/${fundingId}/manual-confirm`, 'employer').send({ outcome: 'RECEIVED', utr: utr('F1'), amountPaise: total }).expect(403);
    await api('post', `work/admin/fundings/${fundingId}/manual-confirm`, 'viewer').send({ outcome: 'RECEIVED', utr: utr('F1'), amountPaise: total }).expect(403);
    await api('post', `work/admin/fundings/${fundingId}/manual-confirm`, 'admin').send({ outcome: 'RECEIVED', utr: 'x', amountPaise: total }).expect(400);
    const short = await api('post', `work/admin/fundings/${fundingId}/manual-confirm`, 'admin').send({ outcome: 'RECEIVED', utr: utr('F1'), amountPaise: total - 100 }).expect(422);
    expect(short.body.error.details).toMatchObject({ expectedPaise: total, receivedPaise: total - 100 });
    expect((await prisma.workJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('FUNDING_REQUIRED');
    await api('get', `work/jobs/${jobId}`).expect(404);

    const pending = await api('get', 'work/admin/fundings/manual', 'viewer').expect(200);
    expect(pending.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: fundingId, reference: funding.body.providerOrderId, amountPaise: total, jobStillWaiting: true })]));

    const confirmed = await api('post', `work/admin/fundings/${fundingId}/manual-confirm`, 'admin').send({ outcome: 'RECEIVED', utr: ` ${utr('F1').toLowerCase()} `, amountPaise: total }).expect(200);
    expect(confirmed.body).toEqual({ received: true, duplicate: false });
    expect(await prisma.workFunding.findUniqueOrThrow({ where: { id: fundingId } })).toMatchObject({ status: 'SUCCEEDED', manualUtr: utr('F1'), manualConfirmedById: uid.admin });
    expect((await api('get', `work/jobs/${jobId}`).expect(200)).body).toMatchObject({ status: 'OPEN', funded: true });
    await api('post', `work/admin/fundings/${fundingId}/manual-confirm`, 'admin').send({ outcome: 'RECEIVED', utr: utr('F1'), amountPaise: total }).expect(409);
    const fundAudit = await prisma.workAuditEvent.findFirstOrThrow({ where: { entityId: fundingId, action: 'FUNDING_MANUAL_CONFIRMED' } });
    expect(fundAudit).toMatchObject({ actorUserId: uid.admin, actorParty: 'PLATFORM' });

    // ---- worker bank details: encrypted at rest, masked everywhere
    const saved = await api('put', 'work/me/profile', 'wa').send(profile('Worker Demo A', { payoutBank: { accountNumber: `${BANK_A.slice(0, 6)} ${BANK_A.slice(6)}`, ifsc: 'demo0005678', accountName: 'Worker Demo A' } })).expect(200);
    expect(saved.body.payoutBankMasked).toEqual({ accountName: 'Worker Demo A', ifsc: 'DEMO0005678', last4: BANK_A.slice(-4) });
    expect(JSON.stringify(saved.body)).not.toContain(BANK_A);
    const stored = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: uid.wa } });
    expect(stored.payoutBankAccountEncrypted).toBeTruthy();
    expect(stored.payoutBankAccountEncrypted).not.toContain(BANK_A);
    await api('put', 'work/me/profile', 'wb').send(profile('Worker Demo B', { payoutBank: { accountNumber: '12ab', ifsc: 'BAD', accountName: 'B' } })).expect(400);
    await api('put', 'work/me/profile', 'wb').send(profile('Worker Demo B')).expect(200);

    // ---- work done and approved
    await api('post', `work/jobs/${jobId}/accept`, 'wa', randomUUID()).expect(201);
    await api('post', `work/jobs/${jobId}/accept`, 'wb', randomUUID()).expect(201);
    const asgA = (await prisma.workAssignment.findFirstOrThrow({ where: { jobId, workerId: uid.wa } })).id;
    const asgB = (await prisma.workAssignment.findFirstOrThrow({ where: { jobId, workerId: uid.wb } })).id;
    const code = (await api('get', `work/orgs/${orgId}/jobs/${jobId}`, 'employer').expect(200)).body.checkInCode as string;
    await doWork('wa', asgA, code, '+91 98200 00001');
    await doWork('wb', asgB, code, '+91 98200 00002');
    for (const a of [asgA, asgB]) {
      await api('post', `work/orgs/${orgId}/assignments/${a}/review`, 'employer').send({ decision: 'APPROVE' }).expect(200);
    }
    const payoutOf = (assignmentId: string) => prisma.workPayout.findFirstOrThrow({ where: { assignmentId }, orderBy: { attempt: 'desc' } });
    const pA = await payoutOf(asgA);
    expect(pA).toMatchObject({ status: 'PROCESSING', provider: 'manual_bank', providerPayoutId: `FQWP-${pA.id}` });
    expect((await payoutOf(asgB)).status).toBe('PENDING'); // no bank details yet: obligation kept, nothing sent

    // ---- NEFT export for finance
    await api('get', 'work/admin/payouts/neft-export.csv', 'viewer').expect(403);
    const exportsBefore = await prisma.workAuditEvent.count({ where: { action: 'PAYOUT_NEFT_EXPORT', actorUserId: uid.admin } });
    const csv = await api('get', 'work/admin/payouts/neft-export.csv', 'admin').expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['cache-control']).toContain('no-store');
    expect(csv.text).toContain(`"${BANK_A}"`);
    expect(csv.text).toContain('"DEMO0005678"');
    expect(csv.text).toContain(`"${(PAY / 100).toFixed(2)}"`);
    expect(csv.text).toContain(pA.id);
    expect(csv.text.trim().split('\r\n')).toHaveLength(2); // header + worker A only
    expect(await prisma.workAuditEvent.count({ where: { action: 'PAYOUT_NEFT_EXPORT', actorUserId: uid.admin } })).toBe(exportsBefore + 1);

    // ---- settle by UTR
    await api('post', `work/admin/payouts/${pA.id}/manual-confirm`, 'viewer').send({ outcome: 'PAID', utr: utr('P1') }).expect(403);
    await api('post', `work/admin/payouts/${pA.id}/manual-confirm`, 'admin').send({ outcome: 'PAID', utr: utr('P1') }).expect(200);
    expect(await payoutOf(asgA)).toMatchObject({ status: 'SUCCEEDED', manualUtr: utr('P1'), manualConfirmedById: uid.admin });
    expect((await prisma.workAssignment.findUniqueOrThrow({ where: { id: asgA } })).status).toBe('PAID');
    await api('post', `work/admin/payouts/${pA.id}/manual-confirm`, 'admin').send({ outcome: 'PAID', utr: utr('P1') }).expect(409);

    // Worker B adds bank details: payout becomes ready; a reused UTR is refused; failure + retry.
    await api('put', 'work/me/profile', 'wb').send(profile('Worker Demo B', { payoutBank: { accountNumber: BANK_B, ifsc: 'DEMO0009999', accountName: 'Worker Demo B' } })).expect(200);
    const pB = await payoutOf(asgB);
    expect(pB.status).toBe('PROCESSING');
    await api('post', `work/admin/payouts/${pB.id}/manual-confirm`, 'admin').send({ outcome: 'PAID', utr: utr('P1') }).expect(409).expect((r) => expect(r.body.error.code).toBe('WORK_UTR_ALREADY_USED'));
    expect((await payoutOf(asgB)).status).toBe('PROCESSING'); // refused atomically: nothing changed
    await api('post', `work/admin/payouts/${pB.id}/manual-confirm`, 'admin').send({ outcome: 'FAILED', reason: 'Beneficiary name mismatch at bank' }).expect(200);
    expect(await payoutOf(asgB)).toMatchObject({ status: 'FAILED', failureReason: 'Beneficiary name mismatch at bank' });
    expect((await prisma.workAssignment.findUniqueOrThrow({ where: { id: asgB } })).status).toBe('PAYABLE');
    const retry = await api('post', `work/admin/payouts/${pB.id}/retry`, 'admin').expect(200);
    await api('post', `work/admin/payouts/${retry.body.payoutId}/manual-confirm`, 'admin').send({ outcome: 'PAID', utr: utr('P2') }).expect(200);
    expect((await prisma.workAssignment.findUniqueOrThrow({ where: { id: asgB } })).status).toBe('PAID');

    const ledger = await api('get', 'work/admin/ledger', 'admin').expect(200);
    expect(ledger.body.balanced).toBe(true);
  });

  it('records a transfer that never arrived and lets the business pay again', async () => {
    const created = await api('post', 'work/orgs', 'employer').send({ ...org, displayName: `${org.displayName} 2` }).expect(201);
    const orgId = created.body.id as string;
    await api('post', `work/orgs/${orgId}/submit`, 'employer').expect(200);
    await api('post', `work/admin/orgs/${orgId}/review`, 'admin').send({ decision: 'VERIFY' }).expect(200);
    const draft = await api('post', `work/orgs/${orgId}/jobs`, 'employer').send(job({ title: `NEFT demo retry ${run}` })).expect(201);
    const published = await api('post', `work/orgs/${orgId}/jobs/${draft.body.id}/publish`, 'employer').send({ version: draft.body.version }).expect(200);
    const first = await api('post', `work/orgs/${orgId}/jobs/${draft.body.id}/fund`, 'employer', `fund-${randomUUID()}`).send({ version: published.body.version }).expect(201);
    await api('post', `work/admin/fundings/${first.body.id}/manual-confirm`, 'admin').send({ outcome: 'NOT_RECEIVED', reason: 'No credit on the statement after 3 days' }).expect(200);
    expect(await prisma.workFunding.findUniqueOrThrow({ where: { id: first.body.id } })).toMatchObject({ status: 'FAILED', manualUtr: null });
    expect((await prisma.workJob.findUniqueOrThrow({ where: { id: draft.body.id } })).status).toBe('FUNDING_REQUIRED');
    const second = await api('post', `work/orgs/${orgId}/jobs/${draft.body.id}/fund`, 'employer', `fund-${randomUUID()}`).send({ version: published.body.version }).expect(201);
    expect(second.body.id).not.toBe(first.body.id);
    // The UTR of a different, already-confirmed transfer cannot be reused.
    await api('post', `work/admin/fundings/${second.body.id}/manual-confirm`, 'admin').send({ outcome: 'RECEIVED', utr: utr('F1'), amountPaise: second.body.amountPaise }).expect(409);
    await api('post', `work/admin/fundings/${second.body.id}/manual-confirm`, 'admin').send({ outcome: 'RECEIVED', utr: utr('F2'), amountPaise: second.body.amountPaise }).expect(200);
    expect((await prisma.workJob.findUniqueOrThrow({ where: { id: draft.body.id } })).status).toBe('OPEN');
    expect((await api('get', 'work/admin/ledger', 'admin').expect(200)).body.balanced).toBe(true);
  });
});
