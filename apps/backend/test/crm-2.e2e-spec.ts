import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SessionAudience } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { BookingsService } from '../src/bookings/bookings.service';
import { QueueService } from '../src/queue/queue.service';
import { TokenService } from '../src/auth/services/token.service';
import { CrmActivityService } from '../src/crm/crm-activity.service';

process.env.JWT_ACCESS_SECRET ??= 'crm2-e2e-only-jwt-secret';
process.env.TOTP_ENCRYPTION_KEY ??= 'crm2-e2e-only-encryption-secret';

const parsed = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '');
  } catch {
    return null;
  }
})();
const DISPOSABLE =
  !!parsed &&
  ['localhost', '127.0.0.1'].includes(parsed.hostname) &&
  (parsed.pathname.endsWith('_e2e') || parsed.pathname === '/owner_ops_chain');
const maybe = DISPOSABLE ? describe : describe.skip;
const run = Math.random().toString(36).slice(2, 8);

/** A tiny but real WebM header (EBML magic) — enough for the server's audio sniffing. */
const webm = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.alloc(2048, 7),
]);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(256, 1),
]);

maybe('Employee CRM 2.0 (authenticated, disposable PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let privateDir: string;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    who: string,
  ) =>
    request(app.getHttpServer())
      [method](`/api/v1/${path}`)
      .set('Authorization', `Bearer ${tok[who]}`);

  async function account(
    label: string,
    roles: Role[],
    audience: SessionAudience,
  ) {
    const user = await prisma.user.create({
      data: {
        email: `crm2-${run}-${label}@example.test`,
        emailVerifiedAt: new Date(),
      },
    });
    for (const role of roles)
      await prisma.userRole.create({
        data: { userId: user.id, role, salonId: null },
      });
    if (
      roles.includes(Role.FIELD_EXECUTIVE) ||
      roles.includes(Role.SALES_ADMIN)
    ) {
      const p = await prisma.employeeProfile.create({
        data: {
          userId: user.id,
          employeeCode: `C2-${run}-${label}`,
          fullName: `Crm ${label} ${run}`,
          territory: 'Noida West',
        },
      });
      ids[`${label}Profile`] = p.id;
    }
    ids[label] = user.id;
    tok[label] = app
      .get(TokenService)
      .signAccessToken(user.id, roles, audience);
  }

  beforeAll(async () => {
    privateDir = mkdtempSync(join(tmpdir(), 'crm2-private-'));
    process.env.PRIVATE_STORAGE_DIR = privateDir;
    delete process.env.SALES_COACH_PROVIDER;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await account('empA', [Role.FIELD_EXECUTIVE], SessionAudience.EMPLOYEE);
    await account('empB', [Role.FIELD_EXECUTIVE], SessionAudience.EMPLOYEE);
    await account('manager', [Role.SALES_ADMIN], SessionAudience.ADMIN);
    await account('admin', [Role.PLATFORM_ADMIN], SessionAudience.ADMIN);
    await account('viewer', [Role.PLATFORM_VIEWER], SessionAudience.ADMIN);
    await account('customer', [Role.CUSTOMER], SessionAudience.CUSTOMER);
  });

  afterAll(async () => {
    await app?.close();
    rmSync(privateDir, { recursive: true, force: true });
  });

  const csv = (rows: string[][]) =>
    Buffer.from(rows.map((r) => r.join(',')).join('\n'));
  const phone = (n: number) =>
    `98${run.replace(/\D/g, '').padEnd(4, '1').slice(0, 4)}${String(n).padStart(4, '0')}`;

  it('1/2. a manager imports leads (mapping, duplicates, errors) and they reach only the assigned employee', async () => {
    const file = csv([
      [
        'Salon Name',
        'Owner',
        'Mobile Number',
        'City',
        'Area',
        'Assigned Employee',
        'Lead Source',
      ],
      [
        `Urban Edge ${run}`,
        'Amit',
        phone(1),
        'Noida',
        'Sector 62',
        `C2-${run}-empA`,
        'Field discovery',
      ],
      [
        `Glow Go ${run}`,
        'Riya',
        phone(2),
        'Ghaziabad',
        'Indirapuram',
        `C2-${run}-empB`,
        'Referral',
      ],
      [
        `Urban Edge Copy ${run}`,
        'Amit',
        phone(1),
        'Noida',
        'Sector 62',
        `C2-${run}-empA`,
        '',
      ],
      ['', 'Nobody', phone(3), 'Noida', '', `C2-${run}-empA`, ''],
      [`Style Loft ${run}`, 'Priya', 'abc', 'Noida', '', `C2-${run}-empA`, ''],
    ]);
    await api('post', 'crm/leads/import/preview', 'empA')
      .attach('file', file, 'leads.csv')
      .expect(403);
    const preview = await api('post', 'crm/leads/import/preview', 'manager')
      .attach('file', file, 'leads.csv')
      .expect(201);
    expect(preview.body).toMatchObject({
      totalRows: 5,
      valid: 2,
      duplicates: 1,
      errors: 2,
    });
    expect(preview.body.mapping).toEqual([
      'shopName',
      'ownerName',
      'phone',
      'city',
      'locality',
      'assignTo',
      'source',
    ]);
    const commit = await api(
      'post',
      `crm/leads/imports/${preview.body.jobId}/commit`,
      'manager',
    ).expect(200);
    expect(commit.body).toEqual({ created: 2, skipped: 3 });
    await api(
      'post',
      `crm/leads/imports/${preview.body.jobId}/commit`,
      'manager',
    ).expect(409);

    const mine = await api('get', `crm/leads?q=${run}`, 'empA').expect(200);
    expect(
      mine.body.items.map((l: { shopName: string }) => l.shopName),
    ).toEqual([`Urban Edge ${run}`]);
    expect(mine.body.items[0]).toMatchObject({
      status: 'ASSIGNED',
      source: 'FIELD_VISIT',
      statusLabel: 'Assigned',
    });
    ids.leadA = mine.body.items[0].id;
    const theirs = await api('get', `crm/leads?q=${run}`, 'empB').expect(200);
    ids.leadB = theirs.body.items[0].id;
    await api('get', `crm/leads/${ids.leadB}`, 'empA').expect(404);
    await api('patch', `crm/leads/${ids.leadB}`, 'empA')
      .send({ notes: 'x' })
      .expect(404);
    const team = await api('get', `crm/leads?q=${run}`, 'manager').expect(200);
    expect(team.body.total).toBe(2);
    await api('get', 'crm/leads', 'customer').expect(403);
    // Assignment notification (deduplicated, in the CRM inbox only).
    const inbox = await api('get', 'crm/notifications', 'empA').expect(200);
    expect(
      inbox.body.items.some(
        (n: { type: string }) => n.type === 'crm.lead_assigned',
      ),
    ).toBe(true);
    // A duplicate typed by hand is refused.
    await api('post', 'crm/leads', 'empA')
      .send({ shopName: 'Again', phone: `+91 ${phone(1)}` })
      .expect(409);
  });

  it('3. call outcomes are logged manually and move the lead + timeline; callbacks are scheduled', async () => {
    const scheduled = await api('post', 'crm/calls', 'empA')
      .send({
        leadId: ids.leadA,
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(201);
    const queue = await api('get', 'crm/calls/queue', 'empA').expect(200);
    expect(queue.body.overdue.map((c: { id: string }) => c.id)).toContain(
      scheduled.body.id,
    );
    await api('post', `crm/calls/${scheduled.body.id}/log`, 'empB')
      .send({ outcome: 'NO_ANSWER' })
      .expect(404);
    const callback = new Date(Date.now() + 864e5).toISOString();
    await api('post', `crm/calls/${scheduled.body.id}/log`, 'empA')
      .send({
        outcome: 'CALLBACK_REQUESTED',
        notes: 'Call after 5pm',
        nextCallbackAt: callback,
        interestLevel: 3,
      })
      .expect(200);
    await api('post', `crm/calls/${scheduled.body.id}/log`, 'empA')
      .send({ outcome: 'CONNECTED' })
      .expect(409);
    const lead = await api('get', `crm/leads/${ids.leadA}`, 'empA').expect(200);
    expect(lead.body).toMatchObject({
      status: 'CALLBACK_REQUESTED',
      contactAttempts: 1,
      interestLevel: 3,
    });
    const timeline = await api(
      'get',
      `crm/leads/${ids.leadA}/timeline`,
      'empA',
    ).expect(200);
    expect(timeline.body.map((t: { type: string }) => t.type)).toEqual(
      expect.arrayContaining(['IMPORTED', 'CALL_SCHEDULED', 'CALL_LOGGED']),
    );
  });

  it('4/6. meetings are scheduled and completed, linked to the lead, with a follow-up task', async () => {
    const startsAt = new Date(Date.now() + 2 * 3600_000).toISOString();
    const m = await api('post', 'crm/meetings', 'empA')
      .send({ leadId: ids.leadA, startsAt, mode: 'PHYSICAL', purpose: 'Demo' })
      .expect(201);
    expect(
      (await api('get', `crm/leads/${ids.leadA}`, 'empA')).body.status,
    ).toBe('DEMO_SCHEDULED');
    await api('patch', `crm/meetings/${m.body.id}`, 'empA')
      .send({ status: 'COMPLETED' })
      .expect(400);
    const followUpAt = new Date(Date.now() + 3 * 864e5).toISOString();
    await api('patch', `crm/meetings/${m.body.id}`, 'empA')
      .send({
        status: 'COMPLETED',
        outcome: 'Owner interested in live queue',
        followUpAt,
        nextAction: 'Start onboarding',
        createFollowUpTask: true,
      })
      .expect(200);
    const lead = (await api('get', `crm/leads/${ids.leadA}`, 'empA')).body;
    expect(lead).toMatchObject({
      status: 'MEETING_COMPLETED',
      nextAction: 'Start onboarding',
    });
    const tasks = await api(
      'get',
      `crm/tasks?leadId=${ids.leadA}`,
      'empA',
    ).expect(200);
    expect(tasks.body.items).toHaveLength(1);
    expect(tasks.body.items[0]).toMatchObject({
      lead: { id: ids.leadA },
      type: 'CALL_OWNER',
    });
    await api('get', `crm/meetings?leadId=${ids.leadA}`, 'empB')
      .expect(200)
      .expect((r) => expect(r.body).toEqual([]));
  });

  it('5. tasks: create, filter, block with reason, bulk complete; overdue counted', async () => {
    const t1 = await api('post', 'crm/tasks', 'empA')
      .send({
        subject: `Capture photos ${run}`,
        type: 'CAPTURE_PHOTOS',
        priority: 'HIGH',
        leadId: ids.leadA,
        dueAt: new Date(Date.now() - 3600_000).toISOString(),
      })
      .expect(201);
    expect(t1.body).toMatchObject({
      overdue: true,
      code: expect.stringMatching(/^T-\d{5}$/),
    });
    await api('post', 'crm/tasks', 'empA')
      .send({ subject: 'x', leadId: ids.leadB })
      .expect(404);
    await api('patch', `crm/tasks/${t1.body.id}`, 'empA')
      .send({ status: 'BLOCKED' })
      .expect(400);
    await api('patch', `crm/tasks/${t1.body.id}`, 'empA')
      .send({ status: 'BLOCKED', blockedReason: 'Shop closed' })
      .expect(200);
    const overdue = await api('get', 'crm/tasks?overdue=true', 'empA').expect(
      200,
    );
    expect(overdue.body.items.map((t: { id: string }) => t.id)).toContain(
      t1.body.id,
    );
    const dash = await api('get', 'crm/dashboard?preset=today', 'empA').expect(
      200,
    );
    expect(dash.body.kpis.overdueTasks).toBeGreaterThanOrEqual(1);
    await api('patch', `crm/tasks/${t1.body.id}`, 'empA')
      .send({ assigneeEmployeeId: ids.empBProfile })
      .expect(403);
    const bulk = await api('post', 'crm/tasks/bulk', 'empA')
      .send({ taskIds: [t1.body.id], status: 'COMPLETED' })
      .expect(200);
    expect(bulk.body.updated).toBe(1);
    const done = await api(
      'get',
      `crm/tasks?status=COMPLETED&q=${run}`,
      'empA',
    ).expect(200);
    expect(done.body.items[0].completedAt).toBeTruthy();
  });

  it('13/14/15. recordings need consent, are private, play back for the owner/manager only; no AI → no fake report', async () => {
    const meta = {
      leadId: ids.leadA,
      durationSeconds: '120',
      consentMethod: 'VERBAL_ON_RECORDING',
      consentAt: new Date().toISOString(),
      submissionKey: `rec-${run}-0001`,
    };
    await api('post', 'crm/recordings', 'empA')
      .field({ ...meta, consentGiven: 'false' })
      .attach('audio', webm, 'a.webm')
      .expect(400);
    await api('post', 'crm/recordings', 'empA')
      .field({ ...meta, consentGiven: 'true' })
      .attach('audio', Buffer.from('not audio at all......'), 'a.webm')
      .expect(400);
    const rec = await api('post', 'crm/recordings', 'empA')
      .field({ ...meta, consentGiven: 'true' })
      .attach('audio', webm, 'a.webm')
      .expect(201);
    expect(rec.body).toMatchObject({
      analysisStatus: 'NOT_CONFIGURED',
      analysis: null,
      consentMethod: 'VERBAL_ON_RECORDING',
    });
    const again = await api('post', 'crm/recordings', 'empA')
      .field({ ...meta, consentGiven: 'true' })
      .attach('audio', webm, 'a.webm')
      .expect(201);
    expect(again.body.id).toBe(rec.body.id);
    const audio = await api(
      'get',
      `crm/recordings/${rec.body.id}/audio`,
      'empA',
    ).expect(200);
    expect(audio.headers['content-type']).toMatch(/audio\/webm/);
    expect(audio.headers['cache-control']).toMatch(/no-store/);
    await api('get', `crm/recordings/${rec.body.id}/audio`, 'empB').expect(404);
    await api('get', `crm/recordings/${rec.body.id}/audio`, 'manager').expect(
      200,
    );
    const analyse = await api(
      'post',
      `crm/recordings/${rec.body.id}/analyze`,
      'manager',
    ).expect(409);
    expect(analyse.body.error.code).toBe('AI_NOT_CONFIGURED');
    expect(
      await prisma.salesRecordingAnalysis.count({
        where: { recordingId: rec.body.id },
      }),
    ).toBe(0);
    const status = await api('get', 'crm/ai/status', 'empA').expect(200);
    expect(status.body).toMatchObject({
      configured: false,
      message: 'AI Analysis Not Configured',
    });
    await api('delete', `crm/recordings/${rec.body.id}`, 'empA').expect(204);
    await api('get', `crm/recordings/${rec.body.id}/audio`, 'empA').expect(404);
  });

  it('16. support tickets: create, staff assign/resolve, owner closes or reopens, internal notes hidden', async () => {
    const t = await api('post', 'crm/tickets', 'empA')
      .send({
        category: 'CAMERA_GPS',
        subject: 'GPS not working',
        description: 'Location permission denied on Android',
        priority: 'HIGH',
        leadId: ids.leadA,
      })
      .expect(201);
    expect(t.body).toMatchObject({
      status: 'OPEN',
      code: expect.stringMatching(/^FQ-T-\d{5}$/),
    });
    await api('post', `crm/tickets/${t.body.id}/attachments`, 'empA')
      .attach('file', png, 's.png')
      .expect(201);
    await api('get', `crm/tickets/${t.body.id}`, 'empB').expect(404);
    await api('patch', `crm/tickets/${t.body.id}`, 'empA')
      .send({ status: 'RESOLVED', resolutionNotes: 'x' })
      .expect(403);
    await api('patch', `crm/tickets/${t.body.id}`, 'manager')
      .send({ assignedToUserId: ids.admin })
      .expect(200);
    await api('post', `crm/tickets/${t.body.id}/comments`, 'manager')
      .send({ body: 'Internal: check device model', internal: true })
      .expect(201);
    await api('post', `crm/tickets/${t.body.id}/comments`, 'empA')
      .send({ body: 'x', internal: true })
      .expect(403);
    await api('patch', `crm/tickets/${t.body.id}`, 'manager')
      .send({ status: 'RESOLVED' })
      .expect(400);
    await api('patch', `crm/tickets/${t.body.id}`, 'manager')
      .send({
        status: 'RESOLVED',
        resolutionNotes: 'Enable precise location in settings',
      })
      .expect(200);
    const seen = await api('get', `crm/tickets/${t.body.id}`, 'empA').expect(
      200,
    );
    expect(seen.body.comments).toEqual([]);
    expect(seen.body.attachments).toHaveLength(1);
    await api('patch', `crm/tickets/${t.body.id}`, 'empA')
      .send({ status: 'REOPENED' })
      .expect(200);
    await api('patch', `crm/tickets/${t.body.id}`, 'viewer')
      .send({ status: 'CLOSED' })
      .expect(403);
  });

  it('7/10/11/17. onboarding from the lead: resume, coordinates private, lead follows onboarding, analytics update', async () => {
    // Start onboarding for the lead (existing onboarding API), save a draft, read it back (resume).
    const created = await api(
      'post',
      `employee/leads/${ids.leadA}/onboarding`,
      'empA',
    ).send({});
    if (created.status !== 201) throw new Error(JSON.stringify(created.body));
    ids.app = created.body.id;
    expect(
      (await api('get', `crm/leads/${ids.leadA}`, 'empA')).body.status,
    ).toBe('ONBOARDING_STARTED');
    await api('patch', `employee/onboarding/${ids.app}`, 'empA')
      .send({
        coordinates: {
          latitude: 28.6271,
          longitude: 77.3726,
          source: 'GPS',
          accuracyMeters: 120,
        },
        washStationCount: 2,
        amenities: ['parking', 'wifi'],
        weeklyHolidays: [2],
        consentMethod: 'WHATSAPP_CONFIRMATION',
        consentByName: 'Amit',
        expectedVersion: created.body.version,
      })
      .expect(200);
    const resumed = await api(
      'get',
      `employee/onboarding/${ids.app}`,
      'empA',
    ).expect(200);
    expect(resumed.body).toMatchObject({
      coordinates: { accuracyMeters: 120, source: 'GPS' },
      locationVerified: false,
      washStationCount: 2,
      amenities: ['parking', 'wifi'],
      weeklyHolidays: [2],
      consentMethod: 'WHATSAPP_CONFIRMATION',
    });
    // Nothing about an unapproved application is public: no salon exists yet.
    expect(resumed.body.salonId ?? null).toBeNull();
    const timeline = await api(
      'get',
      `crm/leads/${ids.leadA}/timeline`,
      'empA',
    ).expect(200);
    expect(
      timeline.body.some(
        (t: { type: string }) => t.type === 'ONBOARDING_STATUS',
      ),
    ).toBe(true);
    // Workflow statuses cannot be typed in by hand.
    await api('patch', `crm/leads/${ids.leadA}`, 'empA')
      .send({ status: 'APPROVED' })
      .expect(400);
    const analytics = await api(
      'get',
      'crm/analytics?preset=today',
      'manager',
    ).expect(200);
    expect(analytics.body.kpis.onboardingInProgress).toBeGreaterThanOrEqual(1);
    expect(analytics.body.funnel[0]).toMatchObject({
      stage: 'Imported / created',
    });
    expect(analytics.body.ai).toMatchObject({
      configured: false,
      averageScore: null,
    });
    expect(
      analytics.body.onboardingQuality.gpsUnverified,
    ).toBeGreaterThanOrEqual(1);
  });

  it('18. manager filters and reassignment respect scope; voice-noted leads keep their author', async () => {
    const own = await api(
      'get',
      `crm/analytics?preset=30d&employeeId=${ids.empBProfile}`,
      'empA',
    ).expect(200);
    expect(
      own.body.employees.map(
        (e: { employee: { id: string } }) => e.employee.id,
      ),
    ).toEqual([ids.empAProfile]);
    const team = await api(
      'get',
      `crm/analytics?preset=30d&employeeId=${ids.empBProfile}`,
      'manager',
    ).expect(200);
    expect(
      team.body.employees.map(
        (e: { employee: { id: string } }) => e.employee.id,
      ),
    ).toEqual([ids.empBProfile]);
    await api('post', `crm/leads/${ids.leadB}/assign`, 'empA')
      .send({ employeeId: ids.empAProfile })
      .expect(403);
    await api('post', `crm/leads/${ids.leadB}/assign`, 'manager')
      .send({ employeeId: ids.empAProfile, note: 'Territory change' })
      .expect(200);
    expect(
      (await api('get', `crm/leads/${ids.leadB}`, 'empA')).body.assignedEmployee
        .id,
    ).toBe(ids.empAProfile);
    await api('get', `crm/leads/${ids.leadB}`, 'empB').expect(404);
    // Reminder sweep is deduplicated: a second run sends nothing new.
    const remind = app.get(CrmActivityService);
    await remind.remind();
    expect(await remind.remind()).toBe(0);
    await api('post', 'crm/leads', 'viewer')
      .send({ shopName: 'v' })
      .expect(403);
  });

  it('CEO message: admins publish text + video; employees see only visible ones and cannot manage', async () => {
    await api('post', 'crm/announcements', 'manager')
      .send({ title: 'no' })
      .expect(403);
    await api('post', 'crm/announcements', 'empA')
      .send({ title: 'no' })
      .expect(403);
    await api('get', 'crm/announcements', 'customer').expect(403);
    const m = await api('post', 'crm/announcements', 'admin')
      .send({ title: 'Diwali', body: 'Great work' })
      .expect(201);
    const id = m.body.id as string;
    await api('post', `crm/announcements/${id}/video`, 'admin')
      .attach('video', png, 'fake.mp4')
      .expect(400);
    await api('post', `crm/announcements/${id}/video`, 'empA')
      .attach('video', webm, 'v.webm')
      .expect(403);
    await api('post', `crm/announcements/${id}/video`, 'admin')
      .attach('video', webm, 'v.webm')
      .expect(201);
    const seen = await api('get', 'crm/announcements', 'empA').expect(200);
    expect(seen.body[0]).toMatchObject({ id, hasVideo: true });
    expect(JSON.stringify(seen.body)).not.toContain('crm/announcements/');
    const v = await api('get', `crm/announcements/${id}/video`, 'empB').expect(
      200,
    );
    expect(v.headers['content-type']).toContain('video/webm');
    await api('patch', `crm/announcements/${id}`, 'admin')
      .send({ isActive: false })
      .expect(200);
    expect(
      (await api('get', 'crm/announcements', 'empA')).body.some(
        (x: { id: string }) => x.id === id,
      ),
    ).toBe(false);
    await api('get', `crm/announcements/${id}/video`, 'empA').expect(404);
    await api('delete', `crm/announcements/${id}`, 'admin').expect(204);
  });

  it('lead status: employees keep the menu during onboarding, submitted leads need a manager, admins may set any', async () => {
    const lead = await prisma.employeeCrmLead.create({
      data: {
        employeeProfileId: ids.empAProfile,
        shopName: `Status ${run}`,
        status: 'ONBOARDING_STARTED',
      },
    });
    const url = `crm/leads/${lead.id}`;
    await api('patch', url, 'empA').send({ status: 'APPROVED' }).expect(400);
    await api('patch', url, 'empA').send({ status: 'FOLLOW_UP' }).expect(200);
    await api('patch', url, 'manager').send({ status: 'APPROVED' }).expect(400);
    await api('patch', url, 'admin')
      .send({ status: 'PENDING_APPROVAL' })
      .expect(200);
    await api('patch', url, 'empA').send({ status: 'LOST' }).expect(409);
    await api('patch', url, 'manager')
      .send({ status: 'INTERESTED' })
      .expect(200);
  });

  it('owner closes the live queue and online booking while the shop stays open', async () => {
    const owner = await prisma.user.create({
      data: { email: `crm2-${run}-owner@example.test` },
    });
    const city = await prisma.city.create({
      data: {
        name: `Pause ${run}`,
        slug: `pause-${run}`,
        countryCode: 'IN',
        state: 'UP',
        country: 'India',
      },
    });
    const salon = await prisma.salon.create({
      data: {
        ownerUserId: owner.id,
        name: 'Pause',
        slug: `pause-${run}`,
        cityId: city.id,
        addressLine: 'x',
        status: 'ACTIVE',
      },
    });
    await prisma.userRole.create({
      data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id },
    });
    const service = await prisma.service.create({
      data: { salonId: salon.id, name: 'Cut', durationMinutes: 30, price: 100 },
    });
    tok.owner = app
      .get(TokenService)
      .signAccessToken(owner.id, [Role.SALON_OWNER], SessionAudience.STAFF);
    const url = `dashboard/salons/${salon.id}/intake`;
    expect((await api('get', url, 'owner').expect(200)).body).toEqual({
      queuePaused: false,
      bookingsPaused: false,
    });
    await api('patch', url, 'customer').send({ queuePaused: true }).expect(403);
    await api('patch', url, 'owner').send({}).expect(400);
    const queue = app.get(QueueService);
    const bookings = app.get(BookingsService);
    const book = () =>
      bookings.create(
        ids.customer,
        {
          salonId: salon.id,
          serviceIds: [service.id],
          slotStart: new Date(Date.now() + 864e5).toISOString(),
        } as never,
        'WEB' as never,
        `k-${run}-${Math.random()}`,
      );
    await api('patch', url, 'owner')
      .send({ queuePaused: true, bookingsPaused: true })
      .expect(200);
    await expect(queue.joinWalkIn(ids.customer, salon.id)).rejects.toThrow(
      /not taking new live queue/,
    );
    await expect(
      queue.joinGuestWalkIn(salon.id, service.id, 'G', '+919800000009'),
    ).rejects.toThrow(/not taking new live queue/);
    await expect(book()).rejects.toThrow(/not taking new online bookings/);
    const row = await prisma.salon.findUniqueOrThrow({
      where: { id: salon.id },
    });
    expect([row.status, row.isClosedForToday]).toEqual(['ACTIVE', false]);
    await api('patch', url, 'owner').send({ queuePaused: false }).expect(200);
    const joined = await queue.joinWalkIn(ids.customer, salon.id, service.id, {
      name: 'G',
      phone: '+919800000009',
    });
    expect(joined.id).toBeTruthy();
  });

  it('employee password reset: an employee gets a working single-use link', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: `crm2-${run}-empB@example.test`, audience: 'employee' })
      .expect(200);
    const link = new URL(r.body.devResetUrl as string);
    expect(link.searchParams.get('audience')).toBe('employee');
    const newPassword = `Reset-${run}-9x!`;
    const body = {
      token: link.searchParams.get('token'),
      newPassword,
      confirmPassword: newPassword,
    };
    const post = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send(body);
    await post().expect(200);
    await post().expect(400);
    const profile = await prisma.user.findUniqueOrThrow({
      where: { id: ids.empB },
    });
    expect(profile.passwordHash).toBeTruthy();
  });
});
