import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  CrmFollowUpChannel,
  CrmFollowUpStatus,
  CrmLeadSource,
  CrmLeadStatus,
  CrmVisitOutcome,
  Role,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

const databaseUrl = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '');
  } catch {
    return null;
  }
})();
const disposableDb =
  ['127.0.0.1', 'localhost'].includes(databaseUrl?.hostname ?? '') &&
  databaseUrl?.pathname === '/owner_ops_chain';
const approvedRunner =
  process.env.GITHUB_ACTIONS === 'true' ||
  process.env.ALLOW_ADMIN_CRM_ANALYTICS_E2E === 'yes';
const describeDisposable =
  disposableDb && approvedRunner ? describe : describe.skip;

describeDisposable(
  'platform admin CRM analytics (authenticated disposable PostgreSQL)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokens: TokenService;
    const run = randomUUID();
    const auth: Record<string, string> = {};
    const ids: Record<string, string> = {};

    const api = (path: string, token?: string) => {
      const req = request(app.getHttpServer()).get(`/api/v1/${path}`);
      if (token) req.set('Authorization', `Bearer ${token}`);
      return req;
    };

    async function createAccount(
      label: string,
      role: Role,
      audience: SessionAudience,
    ) {
      const user = await prisma.user.create({
        data: {
          email: `admin-crm-${run}-${label}@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      });
      await prisma.userRole.create({
        data: { userId: user.id, role, salonId: null },
      });
      auth[label] = tokens.signAccessToken(user.id, [role], audience);
      return user;
    }

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api/v1');
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      prisma = app.get(PrismaService);
      tokens = app.get(TokenService);

      const admin = await createAccount(
        'platform',
        Role.PLATFORM_ADMIN,
        SessionAudience.ADMIN,
      );
      const coFounder = await createAccount(
        'cofounder',
        Role.CO_FOUNDER,
        SessionAudience.ADMIN,
      );
      await createAccount('customer', Role.CUSTOMER, SessionAudience.CUSTOMER);

      const employeeUser = await prisma.user.create({
        data: {
          email: `admin-crm-${run}-employee@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      });
      const employee = await prisma.employeeProfile.create({
        data: {
          userId: employeeUser.id,
          employeeCode: `FQ-FE-${run.slice(0, 8)}`,
          fullName: 'Synthetic CRM Executive',
          territory: `Synthetic Territory ${run.slice(0, 6)}`,
        },
      });
      ids.admin = admin.id;
      ids.cofounder = coFounder.id;
      ids.employee = employee.id;

      const now = new Date();
      const leadA = await prisma.employeeCrmLead.create({
        data: {
          employeeProfileId: employee.id,
          shopName: `Synthetic Lead A ${run}`,
          city: 'Patna',
          source: CrmLeadSource.FIELD_VISIT,
          status: CrmLeadStatus.ONBOARDED,
          createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          onboardedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        },
      });
      const leadB = await prisma.employeeCrmLead.create({
        data: {
          employeeProfileId: employee.id,
          shopName: `Synthetic Lead B ${run}`,
          city: 'Hajipur',
          source: CrmLeadSource.FIELD_VISIT,
          status: CrmLeadStatus.NEW,
          createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(now.getTime() - 60 * 60 * 1000),
        },
      });
      ids.leadA = leadA.id;
      ids.leadB = leadB.id;

      const visit = await prisma.employeeCrmVisit.create({
        data: {
          employeeProfileId: employee.id,
          leadId: leadA.id,
          shopName: leadA.shopName,
          visitedAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
          outcome: CrmVisitOutcome.INTERESTED,
          notes: 'Synthetic visit note',
        },
      });
      ids.visit = visit.id;

      const overdue = await prisma.employeeCrmFollowUp.create({
        data: {
          employeeProfileId: employee.id,
          leadId: leadA.id,
          dueAt: new Date(now.getTime() - 60 * 60 * 1000),
          channel: CrmFollowUpChannel.CALL,
          status: CrmFollowUpStatus.OPEN,
        },
      });
      const completed = await prisma.employeeCrmFollowUp.create({
        data: {
          employeeProfileId: employee.id,
          leadId: leadB.id,
          dueAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
          channel: CrmFollowUpChannel.EMAIL,
          status: CrmFollowUpStatus.COMPLETED,
          completedAt: new Date(now.getTime() - 30 * 60 * 1000),
        },
      });
      ids.overdue = overdue.id;
      ids.completed = completed.id;
    }, 120_000);

    afterAll(async () => {
      await app?.close();
    });

    it('keeps existing CRM array access while protecting complete history and analytics', async () => {
      await api('admin/crm/analytics').expect(401);
      await api(
        'admin/crm/analytics?from=2026-10-01T00:00:00.000Z&to=2026-10-20T00:00:00.000Z',
        auth.cofounder,
      ).expect(403);
      await api('admin/crm/leads/page?limit=20', auth.customer).expect(403);
      await api('admin/crm/leads', auth.cofounder).expect(200);

      const from = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const to = new Date(Date.now() + 60 * 1000).toISOString();
      const analytics = await api(
        `admin/crm/analytics?employeeId=${encodeURIComponent(ids.employee)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        auth.platform,
      ).expect(200);
      expect(analytics.body.totals).toMatchObject({
        leadsCreated: 2,
        onboardedFromPeriodLeads: 1,
        leadsOnboardedInPeriod: 1,
        visits: 1,
        followUpsCompleted: 1,
        openFollowUpsOverdueInPeriod: 1,
      });
      expect(analytics.body.employees).toEqual([
        expect.objectContaining({
          employeeId: ids.employee,
          leadsCreated: 2,
          onboardedFromPeriodLeads: 1,
          conversionPercent: 50,
        }),
      ]);
      expect(analytics.body.employees[0]).not.toHaveProperty('fullName');
      expect(analytics.body.employees[0]).not.toHaveProperty('email');
      expect(analytics.body.employees[0]).not.toHaveProperty('phone');
      await api(
        'admin/crm/analytics?from=2024-01-01T00:00:00.000Z&to=2026-10-20T00:00:00.000Z',
        auth.platform,
      ).expect(400);
    });

    it('pages leads without duplicates and rejects cursors used with different filters', async () => {
      const from = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const to = new Date(Date.now() + 60 * 1000).toISOString();
      // Earlier focused E2E steps share the disposable database with this aggregate
      // regression pass. Scope pagination to this run so their retained fixtures
      // cannot make this test observe a false third page.
      const query = new URLSearchParams({
        from,
        to,
        limit: '1',
        employeeId: ids.employee,
        q: `Synthetic Lead ${run}`,
      }).toString();
      const first = await api(
        `admin/crm/leads/page?${query}`,
        auth.platform,
      ).expect(200);
      expect(first.body.items).toHaveLength(1);
      expect(first.body.nextCursor).toEqual(expect.any(String));
      const second = await api(
        `admin/crm/leads/page?${query}&cursor=${encodeURIComponent(first.body.nextCursor)}`,
        auth.platform,
      ).expect(200);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
      expect(second.body.nextCursor).toBeNull();

      await api(
        `admin/crm/leads/page?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&q=Different&cursor=${encodeURIComponent(first.body.nextCursor)}`,
        auth.platform,
      ).expect(400);
      await api(
        `admin/crm/leads/page?from=${encodeURIComponent(from)}&to=${encodeURIComponent(from)}&limit=1`,
        auth.platform,
      ).expect(400);
    });

    it('filters visit and follow-up pages by status, channel, date and shop text', async () => {
      const from = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const to = new Date(Date.now() + 60 * 1000).toISOString();
      const visits = await api(
        `admin/crm/visits/page?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&outcome=${CrmVisitOutcome.INTERESTED}&q=Synthetic%20Lead%20A`,
        auth.platform,
      ).expect(200);
      expect(
        visits.body.items.map((item: { id: string }) => item.id),
      ).toContain(ids.visit);

      const followUps = await api(
        `admin/crm/follow-ups/page?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=${CrmFollowUpStatus.OPEN}&channel=${CrmFollowUpChannel.CALL}&q=Synthetic%20Lead%20A`,
        auth.platform,
      ).expect(200);
      expect(
        followUps.body.items.map((item: { id: string }) => item.id),
      ).toContain(ids.overdue);
      expect(
        followUps.body.items.map((item: { id: string }) => item.id),
      ).not.toContain(ids.completed);
    });
  },
);
