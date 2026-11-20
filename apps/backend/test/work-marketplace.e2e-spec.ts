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
process.env.WORK_PAYMENT_PROVIDER = 'sandbox';
process.env.WORK_SANDBOX_WEBHOOK_SECRET = 'work-e2e-only-sandbox-secret-not-production';
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

/**
 * FastQue Work — the spec's non-negotiable MVP acceptance scenario and the critical failure and
 * security scenarios, against the real AppModule and a disposable PostgreSQL database (skipped
 * unless DATABASE_URL is loopback and names work_marketplace_ci). Sandbox payments only.
 */
maybe('FastQue Work marketplace (real AppModule, disposable PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
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
      data: { phone: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, phoneVerifiedAt: new Date(), status: UserStatus.ACTIVE, email: `work-${run}-${label}@example.test` },
    });
    uid[label] = u.id;
    t[label] = tokens.signAccessToken(u.id, roles, audience);
  }

  const worker = (label: string) => user(label, [Role.CUSTOMER], SessionAudience.CUSTOMER);
  const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);

  const org = {
    legalName: 'Demo Field Services Private Limited',
    displayName: `Demo Field Services ${run}`,
    orgType: 'MARKETING_AGENCY',
    gstin: '09AAACD1234A1Z5',
    registeredAddress: 'Demo address, Knowledge Park II, Greater Noida',
    city: 'Greater Noida',
    contactName: 'Demo Contact',
    contactPhone: '+919811111111',
    contactEmail: 'demo-ops@example.test',
  };

  const job = (over: Record<string, unknown> = {}) => ({
    categorySlug: 'merchant-onboarding',
    title: `Salon onboarding visits ${run}`,
    description: 'DEMO DATA. Visit assigned salons, explain the FastQue app, obtain owner consent and register interested salons.',
    locationType: 'ON_SITE',
    addressLine: 'Pari Chowk area, Greater Noida',
    city: 'Greater Noida',
    positions: 5,
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
    payoutUpiVpa: `${name.toLowerCase().replace(/\s+/g, '')}@okdemo`,
    ...extra,
  });

  async function verifiedOrg(ownerLabel: string): Promise<string> {
    const created = await api('post', 'work/orgs', ownerLabel).send(org).expect(201);
    await api('post', `work/orgs/${created.body.id}/submit`, ownerLabel).expect(200);
    await api('post', `work/admin/orgs/${created.body.id}/review`, 'admin').send({ decision: 'VERIFY' }).expect(200);
    return created.body.id as string;
  }

  async function openJob(ownerLabel: string, orgId: string, over: Record<string, unknown> = {}) {
    const draft = await api('post', `work/orgs/${orgId}/jobs`, ownerLabel).send(job(over)).expect(201);
    const published = await api('post', `work/orgs/${orgId}/jobs/${draft.body.id}/publish`, ownerLabel).send({ version: draft.body.version }).expect(200);
    expect(published.body.status).toBe('FUNDING_REQUIRED');
    const funding = await api('post', `work/orgs/${orgId}/jobs/${draft.body.id}/fund`, ownerLabel, `fund-${randomUUID()}`).send({ version: published.body.version }).expect(201);
    await api('post', `work/sandbox/fundings/${funding.body.id}/complete`, ownerLabel).send({ outcome: 'SUCCEEDED' }).expect(200);
    return { jobId: draft.body.id as string, fundingId: funding.body.id as string, amount: funding.body.amountPaise as number };
  }

  async function doWork(label: string, assignmentId: string, code: string, phone: string, photo = png()) {
    await api('post', `work/assignments/${assignmentId}/check-in`, label).send({ method: 'QR_CODE', code }).expect(200);
    await api('put', `work/assignments/${assignmentId}/responses/consent`, label).send({ confirmed: true }).expect(200);
    await api('put', `work/assignments/${assignmentId}/responses/shop-phone`, label).send({ text: phone }).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/work/assignments/${assignmentId}/evidence/storefront`).set('Authorization', `Bearer ${t[label]}`).attach('file', photo, 'storefront.png').expect(201);
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
    await user('otherEmployer', [Role.CUSTOMER], SessionAudience.CUSTOMER);
    await user('admin', [Role.PLATFORM_ADMIN], SessionAudience.ADMIN);
    await user('viewer', [Role.PLATFORM_VIEWER], SessionAudience.ADMIN);
    for (let i = 1; i <= 8; i++) await worker(`w${i}`);
    await worker('minor');
    await worker('noSkill');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('runs the MVP acceptance scenario end to end and keeps the ledger balanced', async () => {
    // ---- business verification gate
    const pending = await api('post', 'work/orgs', 'employer').send(org).expect(201);
    expect(pending.body.status).toBe('DRAFT');
    const draft0 = await api('post', `work/orgs/${pending.body.id}/jobs`, 'employer').send(job()).expect(201);
    const blocked = await api('post', `work/orgs/${pending.body.id}/jobs/${draft0.body.id}/publish`, 'employer').send({ version: 1 }).expect(403);
    expect(blocked.body.error.code).toBe('WORK_ORG_NOT_VERIFIED');
    await api('post', `work/orgs/${pending.body.id}/submit`, 'employer').expect(200);
    await api('post', `work/admin/orgs/${pending.body.id}/review`, 'viewer').send({ decision: 'VERIFY' }).expect(403); // read-only role
    const verified = await api('post', `work/admin/orgs/${pending.body.id}/review`, 'admin').send({ decision: 'VERIFY' }).expect(200);
    expect(verified.body.status).toBe('VERIFIED');
    const orgId = pending.body.id as string;

    // ---- post, validate, preview quote, publish, fund
    const draft = await api('post', `work/orgs/${orgId}/jobs`, 'employer').send(job()).expect(201);
    const jobId = draft.body.id as string;
    expect(draft.body.quote).toEqual({ positions: 5, payPerWorkerPaise: PAY, feeBps: 1000, workerPayTotalPaise: 5 * PAY, platformFeeTotalPaise: 5 * FEE, employerTotalPaise: 5 * (PAY + FEE) });
    const invalid = await api('post', `work/orgs/${orgId}/jobs`, 'employer').send(job({ minAge: 16 })).expect(400);
    expect(invalid.body.error).toBeDefined();
    await api('post', `work/orgs/${orgId}/jobs/${jobId}/publish`, 'employer').send({ version: 99 }).expect(409);
    const published = await api('post', `work/orgs/${orgId}/jobs/${jobId}/publish`, 'employer').send({ version: draft.body.version }).expect(200);
    expect(published.body.status).toBe('FUNDING_REQUIRED');

    // Not visible to workers before funding is confirmed.
    expect((await api('get', `work/jobs/${jobId}`).expect(404)).body.error.code).toBe('WORK_NOT_FOUND');

    const fundKey = `fund-${randomUUID()}`;
    const funding = await api('post', `work/orgs/${orgId}/jobs/${jobId}/fund`, 'employer', fundKey).send({ version: published.body.version }).expect(201);
    expect(funding.body).toMatchObject({ status: 'CREATED', amountPaise: 5 * (PAY + FEE), sandbox: true });
    const again = await api('post', `work/orgs/${orgId}/jobs/${jobId}/fund`, 'employer', fundKey).send({ version: published.body.version }).expect(201);
    expect(again.body.id).toBe(funding.body.id); // idempotent replay, no second order

    // Forged webhook: rejected and audited, job stays unfunded.
    const forged = await api('post', 'work/payments/webhook').set('x-work-signature', 'a'.repeat(64)).set('x-work-timestamp', String(Math.floor(Date.now() / 1000))).send({ eventId: 'evt_forged', type: 'funding.succeeded', reference: funding.body.providerOrderId, amountPaise: 5 * (PAY + FEE), createdAt: Math.floor(Date.now() / 1000) }).expect(401);
    expect(forged.body.error.code).toBe('WORK_WEBHOOK_SIGNATURE_INVALID');
    expect(await prisma.workAuditEvent.count({ where: { action: 'WEBHOOK_REJECTED' } })).toBeGreaterThan(0);

    const settled = await api('post', `work/sandbox/fundings/${funding.body.id}/complete`, 'employer').send({ outcome: 'SUCCEEDED' }).expect(200);
    expect(settled.body).toEqual({ received: true, duplicate: false });
    const open = await api('get', `work/jobs/${jobId}`).expect(200);
    expect(open.body).toMatchObject({ status: 'OPEN', funded: true, slotsLeft: 5 });
    expect(open.body.checkInCode).toBeUndefined();
    expect(JSON.stringify(open.body)).not.toContain(org.contactPhone);

    // Replaying the exact signed event is a no-op.
    const evt = await prisma.workWebhookEvent.findFirstOrThrow({ where: { eventType: 'funding.succeeded', payload: { path: ['reference'], equals: funding.body.providerOrderId } } });
    expect(evt.processedAt).not.toBeNull();

    // ---- published terms cannot be edited
    // A valid body (pay still covers the 25_000 arrival compensation), so only the state rule can refuse it.
    const edit = await api('put', `work/orgs/${orgId}/jobs/${jobId}`, 'employer').send(job({ payPerWorkerPaise: 30_000 })).expect(409);
    expect(edit.body.error.code).toBe('WORK_JOB_NOT_EDITABLE');

    // ---- worker onboarding and eligibility
    await api('put', 'work/me/profile', 'minor').send(profile('Minor Demo', { dateOfBirth: '2010-01-01' })).expect(422);
    await api('put', 'work/me/profile', 'noSkill').send(profile('No Skill Demo', { skills: ['excel'] })).expect(200);
    const ne = await api('post', `work/jobs/${jobId}/accept`, 'noSkill', randomUUID()).expect(403);
    expect(ne.body.error).toMatchObject({ code: 'WORK_NOT_ELIGIBLE', details: { reasons: ['MISSING_SKILLS'], missingSkills: ['hindi'] } });
    for (let i = 1; i <= 6; i++) {
      await api('put', 'work/me/profile', `w${i}`).send(profile(`Worker Demo ${i}`, i === 3 ? { payoutUpiVpa: null } : {})).expect(200);
    }
    const view = await api('get', `work/me/jobs/${jobId}`, 'w1').expect(200);
    expect(view.body.viewer).toMatchObject({ hasProfile: true, eligible: true, reasons: [] });
    await api('post', `work/jobs/${jobId}/accept`, 'employer', randomUUID()).expect(422); // no worker profile

    // ---- six workers race for five slots
    const race = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => api('post', `work/jobs/${jobId}/accept`, `w${i}`, randomUUID())));
    const won = race.filter((r) => r.status === 201);
    const lost = race.filter((r) => r.status !== 201);
    expect(won).toHaveLength(5);
    expect(lost).toHaveLength(1);
    expect(lost[0].status).toBe(409);
    expect(lost[0].body.error.code).toBe('WORK_JOB_FULL');
    const live = await prisma.workAssignment.findMany({ where: { jobId }, orderBy: { slotNumber: 'asc' } });
    expect(live.map((a) => a.slotNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(await prisma.workJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ filledCount: 5, status: 'FILLED' });
    const loser = `w${race.indexOf(lost[0]) + 1}`;

    const byWorker: Record<string, string> = {};
    for (const a of live) byWorker[Object.keys(uid).find((k) => uid[k] === a.workerId)!] = a.id;
    const workers = Object.keys(byWorker).sort();
    expect(workers).toHaveLength(5);
    expect(workers).not.toContain(loser);
    const dup = await api('post', `work/jobs/${jobId}/accept`, workers[0], randomUUID()).expect(409);
    expect(dup.body.error.code).toBe('WORK_ALREADY_ASSIGNED');

    // ---- instructions, isolation
    const mine = await api('get', `work/assignments/${byWorker[workers[0]]}`, workers[0]).expect(200);
    expect(mine.body.job.checklist).toHaveLength(3);
    expect(mine.body.job.cancellationTerms.employerCancelAfterArrivalPaise).toBe(25_000);
    expect(mine.body.checkInCode).toBeUndefined();
    await api('get', `work/assignments/${byWorker[workers[0]]}`, workers[1]).expect(404);
    await api('get', `work/assignments/${byWorker[workers[0]]}`, 'otherEmployer').expect(404);
    const employerView = await api('get', `work/orgs/${orgId}/jobs/${jobId}`, 'employer').expect(200);
    const code = employerView.body.checkInCode as string;
    expect(code).toMatch(/^\d{6}$/);

    // ---- execution
    const wrong = await api('post', `work/assignments/${byWorker[workers[0]]}/check-in`, workers[0]).send({ method: 'QR_CODE', code: code === '000000' ? '111111' : '000000' }).expect(422);
    expect(wrong.body.error.code).toBe('WORK_INVALID_CHECK_IN_CODE');
    await api('post', `work/assignments/${byWorker[workers[0]]}/submit`, workers[0]).expect(409); // not checked in
    const sharedPhoto = png();
    await doWork(workers[0], byWorker[workers[0]], code, '+91 98100 00001', sharedPhoto);
    await doWork(workers[1], byWorker[workers[1]], code, '+919810000001'); // same phone, formatted differently
    await doWork(workers[2], byWorker[workers[2]], code, '+919810000003', sharedPhoto); // reused photo
    await doWork(workers[3], byWorker[workers[3]], code, '+919810000004');
    await api('post', `work/assignments/${byWorker[workers[4]]}/check-in`, workers[4]).send({ method: 'QR_CODE', code }).expect(200);
    const incomplete = await api('post', `work/assignments/${byWorker[workers[4]]}/submit`, workers[4]).expect(422);
    expect(incomplete.body.error).toMatchObject({ code: 'WORK_CHECKLIST_INCOMPLETE', details: { missing: ['consent', 'shop-phone', 'storefront'] } });
    await api('put', `work/assignments/${byWorker[workers[4]]}/responses/consent`, workers[4]).send({ confirmed: true }).expect(200);
    await api('put', `work/assignments/${byWorker[workers[4]]}/responses/shop-phone`, workers[4]).send({ text: '+919810000005' }).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/work/assignments/${byWorker[workers[4]]}/evidence/storefront`).set('Authorization', `Bearer ${t[workers[4]]}`).attach('file', Buffer.from('<svg onload="alert(1)"></svg>'), 'evil.png').expect(422);
    await request(app.getHttpServer()).post(`/api/v1/work/assignments/${byWorker[workers[4]]}/evidence/storefront`).set('Authorization', `Bearer ${t[workers[4]]}`).attach('file', png(), 'ok.png').expect(201);
    await api('post', `work/assignments/${byWorker[workers[4]]}/submit`, workers[4]).expect(200);
    expect((await prisma.workJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('IN_PROGRESS');

    // Duplicate signals are visible to the employer (never to the worker) and reject nothing.
    const review = await api('get', `work/orgs/${orgId}/jobs/${jobId}`, 'employer').expect(200);
    const flags = Object.fromEntries(review.body.assignments.map((a: { id: string; duplicateFlags: number }) => [a.id, a.duplicateFlags]));
    expect(flags[byWorker[workers[1]]]).toBe(1);
    expect(flags[byWorker[workers[2]]]).toBe(1);
    expect(flags[byWorker[workers[0]]]).toBe(0);
    const w2view = await api('get', `work/assignments/${byWorker[workers[1]]}`, workers[1]).expect(200);
    expect(w2view.body.responses.every((r: { duplicateFlag: boolean }) => !r.duplicateFlag)).toBe(true);

    // Evidence is private.
    const fileId = w2view.body.responses.find((r: { itemId: string }) => r.itemId === 'storefront').evidenceFileId as string;
    await api('get', `work/evidence/${fileId}`, workers[1]).expect(200).expect('Content-Type', 'image/png');
    await api('get', `work/evidence/${fileId}`, 'employer').expect(200);
    await api('get', `work/evidence/${fileId}`, workers[0]).expect(404);
    await api('get', `work/evidence/${fileId}`, 'otherEmployer').expect(404);

    // ---- security: cross-organization, self-approval, unauthorized admin
    const otherOrg = await verifiedOrg('otherEmployer');
    await api('get', `work/orgs/${orgId}/jobs/${jobId}`, 'otherEmployer').expect(404);
    await api('post', `work/orgs/${otherOrg}/assignments/${byWorker[workers[0]]}/review`, 'otherEmployer').send({ decision: 'APPROVE' }).expect(404);
    await api('post', `work/orgs/${orgId}/assignments/${byWorker[workers[0]]}/review`, workers[0]).send({ decision: 'APPROVE' }).expect(404);
    await api('get', 'work/admin/overview', workers[0]).expect(403);
    await api('post', `work/sandbox/payouts/${randomUUID()}/settle`, 'employer').send({ outcome: 'SUCCEEDED' }).expect(403);

    // ---- review
    for (const w of workers.slice(0, 3)) {
      const r = await api('post', `work/orgs/${orgId}/assignments/${byWorker[w]}/review`, 'employer').send({ decision: 'APPROVE' }).expect(200);
      expect(r.body.status).toBe('PAYABLE');
    }
    await api('post', `work/orgs/${orgId}/assignments/${byWorker[workers[0]]}/review`, 'employer').send({ decision: 'APPROVE' }).expect(409); // never twice
    await api('post', `work/orgs/${orgId}/assignments/${byWorker[workers[3]]}/review`, 'employer').send({ decision: 'REQUEST_REWORK', note: 'Storefront photo is blurry, please retake it.' }).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/work/assignments/${byWorker[workers[3]]}/evidence/storefront`).set('Authorization', `Bearer ${t[workers[3]]}`).attach('file', png(), 'retake.png').expect(201);
    await api('post', `work/assignments/${byWorker[workers[3]]}/submit`, workers[3]).expect(200);
    await api('post', `work/orgs/${orgId}/assignments/${byWorker[workers[3]]}/review`, 'employer').send({ decision: 'APPROVE' }).expect(200);

    // Quality dispute → neutral platform review → partial award.
    const dispute = await api('post', `work/assignments/${byWorker[workers[4]]}/disputes`, 'employer').send({ reasonCode: 'QUALITY_ISSUE', description: 'Only two of the four salon details were entered.' }).expect(201);
    expect((await prisma.workAssignment.findUniqueOrThrow({ where: { id: byWorker[workers[4]] } })).status).toBe('DISPUTED');
    await api('post', `work/admin/disputes/${dispute.body.id}/resolve`, 'admin').send({ awardPaise: PAY + 1, note: 'Too much' }).expect(422);
    const resolved = await api('post', `work/admin/disputes/${dispute.body.id}/resolve`, 'admin').send({ awardPaise: 30_000, note: 'Visit completed, half of the details missing.' }).expect(200);
    expect(resolved.body).toMatchObject({ status: 'RESOLVED', awardPaise: 30_000 });

    // ---- payouts: success, failure + safe retry, worker without UPI, replay
    const payoutOf = async (w: string) => prisma.workPayout.findFirstOrThrow({ where: { assignmentId: byWorker[w] }, orderBy: { attempt: 'desc' } });
    expect((await payoutOf(workers[0])).status).toBe('PROCESSING');
    const noUpi = workers.find((w) => w === 'w3');
    if (noUpi) expect((await payoutOf(noUpi)).status).toBe('PENDING');

    const settle = (payoutId: string, outcome: 'SUCCEEDED' | 'FAILED') => api('post', `work/sandbox/payouts/${payoutId}/settle`, 'admin').send({ outcome });
    const paidWorkers = workers.filter((w) => w !== noUpi);
    const failing = paidWorkers[1];
    for (const w of paidWorkers) {
      const p = await payoutOf(w);
      await settle(p.id, w === failing ? 'FAILED' : 'SUCCEEDED').expect(200);
    }
    const failed = await payoutOf(failing);
    expect(failed.status).toBe('FAILED');
    expect((await prisma.workAssignment.findUniqueOrThrow({ where: { id: byWorker[failing] } })).status).toBe('PAYABLE'); // obligation kept
    await settle(failed.id, 'SUCCEEDED').expect(200); // a late success for a failed attempt changes nothing
    expect((await payoutOf(failing)).status).toBe('FAILED');
    const retry = await api('post', `work/admin/payouts/${failed.id}/retry`, 'admin').expect(200);
    await api('post', `work/admin/payouts/${failed.id}/retry`, 'admin').expect(409); // only one live attempt
    const retried = await prisma.workPayout.findUniqueOrThrow({ where: { id: retry.body.payoutId } });
    expect(retried).toMatchObject({ attempt: 2, status: 'PROCESSING' });
    await settle(retried.id, 'SUCCEEDED').expect(200);
    await settle(retried.id, 'SUCCEEDED').expect(200); // replayed: still paid exactly once

    if (noUpi) {
      await api('put', 'work/me/profile', noUpi).send(profile(`Worker Demo 3`, { payoutUpiVpa: 'workerdemo3@okdemo' })).expect(200);
      const p = await payoutOf(noUpi);
      expect(p.status).toBe('PROCESSING');
      await settle(p.id, 'SUCCEEDED').expect(200);
    }

    for (const w of workers) {
      expect((await prisma.workAssignment.findUniqueOrThrow({ where: { id: byWorker[w] } })).status).toBe('PAID');
      const paid = await prisma.workPayout.aggregate({ where: { assignmentId: byWorker[w], status: 'SUCCEEDED' }, _sum: { amountPaise: true } });
      expect(paid._sum.amountPaise).toBe(w === workers[4] ? 30_000 : PAY);
    }

    // ---- both parties see the right status and money
    const earnings = await api('get', 'work/me/earnings', workers[0]).expect(200);
    expect(earnings.body).toMatchObject({ payablePaise: 0, paidPaise: PAY });
    const dash = await api('get', 'work/me/dashboard', workers[4]).expect(200);
    expect(dash.body.completed[0]).toMatchObject({ status: 'PAID', approvedAmountPaise: 30_000, payoutStatus: 'SUCCEEDED' });

    const approvedPay = 4 * PAY + 30_000;
    const fees = 4 * FEE + 3_000;
    const report = await api('get', `work/orgs/${orgId}/report`, 'employer').expect(200);
    expect(report.body).toMatchObject({ fundedPaise: 5 * (PAY + FEE), workerPayApprovedPaise: approvedPay, platformFeesPaise: fees, paidOutPaise: approvedPay, owedToWorkersPaise: 0 });
    await api('get', `work/orgs/${orgId}/report`, 'otherEmployer').expect(404);

    const closed = await api('post', `work/orgs/${orgId}/jobs/${jobId}/close`, 'employer').expect(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', releasedPaise: 5 * (PAY + FEE) - approvedPay - fees });

    // ---- the administrator can audit the whole transaction
    const audit = await api('get', `work/admin/audit?jobId=${jobId}`, 'viewer').expect(200);
    const actions = new Set(audit.body.map((e: { action: string }) => e.action));
    for (const a of ['JOB_DRAFTED', 'JOB_VALIDATED', 'FUNDING_ORDER_CREATED', 'FUNDING_SUCCEEDED', 'JOB_OPENED', 'SLOT_ACCEPTED', 'CHECKED_IN', 'SUBMITTED', 'REWORK_REQUESTED', 'RESUBMITTED', 'APPROVED', 'DISPUTE_OPENED', 'DISPUTE_AWARD_PAYABLE', 'PAYOUT_FAILED', 'PAYOUT_RETRY_CREATED', 'PAYOUT_SUCCEEDED', 'ASSIGNMENT_PAID', 'FUNDS_RELEASED', 'JOB_CLOSED']) {
      expect(actions).toContain(a);
    }
    await expect(prisma.$executeRawUnsafe(`UPDATE "work_audit_events" SET "note" = 'tampered' WHERE "jobId" = '${jobId}'`)).rejects.toThrow(/work_append_only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "work_ledger_entries"`)).rejects.toThrow(/work_append_only/);

    const ledger = await api('get', 'work/admin/ledger', 'admin').expect(200);
    expect(ledger.body.balanced).toBe(true);
    expect(ledger.body.unbalancedJournals).toEqual([]);
  });

  it('pays disclosed compensation when the employer cancels after the worker arrived', async () => {
    await user('cancelEmployer', [Role.CUSTOMER], SessionAudience.CUSTOMER);
    const orgId = await verifiedOrg('cancelEmployer');
    const { jobId } = await openJob('cancelEmployer', orgId, { positions: 2, title: `Stock audit ${run}`, categorySlug: 'inventory-audits' });
    await api('put', 'work/me/profile', 'w7').send(profile('Worker Demo 7')).expect(200);
    await api('put', 'work/me/profile', 'w8').send(profile('Worker Demo 8')).expect(200);
    const a7 = await api('post', `work/jobs/${jobId}/accept`, 'w7', randomUUID()).expect(201);
    const a8 = await api('post', `work/jobs/${jobId}/accept`, 'w8', randomUUID()).expect(201);
    const code = (await api('get', `work/orgs/${orgId}/jobs/${jobId}`, 'cancelEmployer').expect(200)).body.checkInCode;
    await api('post', `work/assignments/${a7.body.assignmentId}/check-in`, 'w7').send({ method: 'QR_CODE', code }).expect(200);

    const c = await api('post', `work/orgs/${orgId}/jobs/${jobId}/cancel`, 'cancelEmployer').send({ reason: 'Store closed unexpectedly' }).expect(200);
    expect(c.body.status).toBe('CANCELLED');
    const after7 = await prisma.workAssignment.findUniqueOrThrow({ where: { id: a7.body.assignmentId } });
    expect(after7).toMatchObject({ status: 'PAYABLE', approvedAmountPaise: 25_000 });
    // Worker 8 had not arrived; this job discloses ₹0 for a pre-arrival cancellation.
    expect((await prisma.workAssignment.findUniqueOrThrow({ where: { id: a8.body.assignmentId } })).status).toBe('CANCELLED');
    const p = await prisma.workPayout.findFirstOrThrow({ where: { assignmentId: a7.body.assignmentId } });
    expect(p).toMatchObject({ amountPaise: 25_000, status: 'PROCESSING' });
    await api('post', `work/sandbox/payouts/${p.id}/settle`, 'admin').send({ outcome: 'SUCCEEDED' }).expect(200);
    const closed = await api('post', `work/orgs/${orgId}/jobs/${jobId}/close`, 'cancelEmployer').expect(200);
    expect(closed.body.releasedPaise).toBe(2 * (PAY + FEE) - (25_000 + 2_500));
    expect((await api('get', 'work/admin/ledger', 'admin').expect(200)).body.balanced).toBe(true);
  });

  it('approves work automatically when the employer misses the disclosed review window', async () => {
    await user('slowEmployer', [Role.CUSTOMER], SessionAudience.CUSTOMER);
    await worker('w9');
    const orgId = await verifiedOrg('slowEmployer');
    const { jobId } = await openJob('slowEmployer', orgId, { positions: 1, title: `Data entry ${run}`, requiresCheckIn: false, locationType: 'REMOTE', addressLine: null, checklist: [{ id: 'sheet', label: 'Enter all rows into the sheet', kind: 'CONFIRM' }], categorySlug: 'data-entry' });
    await api('put', 'work/me/profile', 'w9').send(profile('Worker Demo 9')).expect(200);
    const a = await api('post', `work/jobs/${jobId}/accept`, 'w9', randomUUID()).expect(201);
    await api('put', `work/assignments/${a.body.assignmentId}/responses/sheet`, 'w9').send({ confirmed: true }).expect(200);
    await api('post', `work/assignments/${a.body.assignmentId}/submit`, 'w9').expect(200);
    await prisma.workAssignment.update({ where: { id: a.body.assignmentId }, data: { reviewDueAt: new Date(Date.now() - 1000) } });
    const sweep = await api('post', 'work/admin/sweep', 'admin').expect(200);
    expect(sweep.body.autoApproved).toBeGreaterThanOrEqual(1);
    const after = await prisma.workAssignment.findUniqueOrThrow({ where: { id: a.body.assignmentId } });
    expect(after).toMatchObject({ status: 'PAYABLE', approvedAmountPaise: PAY });
    expect(await prisma.workAuditEvent.count({ where: { entityId: a.body.assignmentId, action: 'AUTO_APPROVED' } })).toBe(1);
    await api('post', 'work/admin/sweep', 'admin').expect(200); // a second sweep posts nothing new
    expect(await prisma.workLedgerJournal.count({ where: { assignmentId: a.body.assignmentId, kind: 'WORK_APPROVED' } })).toBe(1);
  });

  it('rejects stale webhooks, keeps money moves out of the client and works without any AI provider', async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    await api('post', 'work/payments/webhook').set('x-work-signature', 'b'.repeat(64)).set('x-work-timestamp', String(stale)).send({ eventId: 'old', type: 'payout.succeeded', reference: 'x', amountPaise: 1, createdAt: stale }).expect(401);
    const draft = await api('post', 'work/draft', 'employer').send({ text: 'Need 3 helpers in Pune for an event' }).expect(200);
    expect(draft.body.fields.positions).toBe(3);
    expect(draft.body.missing).toContain('Guaranteed pay per worker');
    const cats = await api('get', 'work/categories').expect(200);
    expect(cats.body).toHaveLength(20);
    const list = await api('get', 'work/jobs?city=Greater%20Noida').expect(200);
    expect(Array.isArray(list.body.items)).toBe(true);
  });
});
