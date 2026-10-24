import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SessionAudience, UserStatus } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';
import { AuthService } from '../src/auth/auth.service';

/**
 * Employee field operations (requirement 28, PR #196) integrated into the 26-scope candidate: the REAL AppModule,
 * real Prisma, real PostgreSQL, real JWT + roles guards. Employees are provisioned through the real admin endpoint
 * and sign in through the real employee login, with synthetic data only.
 *
 * SAFETY: it creates data, so it refuses to run against anything but a local database, and every fixture carries
 * this run's unique tag.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = LOCAL_DB ? describe : describe.skip;

type Json = Record<string, any>;

maybe(
  'Employee field operations on the 26-scope candidate (e2e, disposable local database)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokens: TokenService;
    let authService: AuthService;

    const run = randomUUID().slice(0, 8);
    const tok: Record<string, string> = {};
    const ids: Record<string, string> = {};
    const codes: Record<string, string> = {};
    const PASSWORD = 'Synthetic-Pass-1';

    const call = (
      method: 'get' | 'post' | 'patch',
      path: string,
      token?: string,
      body?: unknown,
    ) => {
      const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
      if (token) req.set('Authorization', `Bearer ${token}`);
      if (method !== 'get') req.set('Idempotency-Key', randomUUID());
      return body === undefined ? req : req.send(body as object);
    };

    async function makeUser(
      label: string,
      role: Role,
      audience: SessionAudience,
      salonId: string | null = null,
    ) {
      const user = await prisma.user.create({
        data: {
          email: `fo-${run}-${label}@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      await prisma.userRole.create({
        data: { userId: user.id, role, salonId },
      });
      ids[label] = user.id;
      tok[label] = tokens.signAccessToken(user.id, [role], audience);
      return user;
    }

    /** Provision a field employee through the real admin endpoint, then sign in through the real login service. */
    async function provisionEmployee(label: string) {
      const created = await call('post', 'admin/employees', tok.hr, {
        fullName: `Synthetic Employee ${label} ${run}`,
        territory: 'Patna',
        password: PASSWORD,
        confirmPassword: PASSWORD,
      });
      expect(created.status).toBe(201);
      codes[label] = created.body.employeeCode;
      ids[label] = created.body.userId ?? created.body.user?.id;
      const login = await authService.employeeLogin(codes[label], PASSWORD);
      tok[label] = login.tokens.accessToken;
      return created.body as Json;
    }

    const lead = async (label: string, name: string) => {
      const res = await call('post', 'employee/leads', tok[label], {
        shopName: name,
        city: 'Patna',
      });
      expect(res.status).toBe(201);
      return res.body as Json;
    };

    const draft = (shopName: string, over: Json = {}) => ({
      shopName,
      ownerName: 'Synthetic Owner',
      mobile: null,
      address: null,
      city: 'Patna',
      locality: null,
      chairs: 3,
      staffCount: 2,
      services: [{ name: 'Haircut', priceRupees: 150 }],
      notes: null,
      ...over,
    });
    const createBody = (shopName: string, over: Json = {}) => ({
      submissionKey: randomUUID(),
      transcript: `Visited ${shopName}`,
      language: 'en-IN',
      structuredDraft: draft(shopName),
      ...over,
    });
    const logsPath = (leadId: string) => `employee/leads/${leadId}/voice-visit-logs`;
    const confirmBody = (row: Json, over: Json = {}) => ({
      transcript: row.transcript,
      language: row.language,
      structuredDraft: row.structuredDraft,
      status: 'CONFIRMED',
      reviewAcknowledged: true,
      ...over,
    });

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api/v1');
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      // One listening server shared by every request, so parallel supertest calls do not each bind a port.
      await app.listen(0);
      prisma = app.get(PrismaService);
      tokens = app.get(TokenService);
      authService = app.get(AuthService);

      await makeUser('hr', Role.HR_ADMIN, SessionAudience.ADMIN);
      await makeUser('customer', Role.CUSTOMER, SessionAudience.CUSTOMER);
      await provisionEmployee('empA');
      await provisionEmployee('empB');
    }, 120_000);

    afterAll(async () => {
      await app?.close();
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('authorization', () => {
      it('rejects anonymous callers, other audiences and roles, and an employee with no profile', async () => {
        const own = await lead('empA', `Auth Lead ${run}`);
        const path = logsPath(own.id);

        expect((await call('get', path)).status).toBe(401);
        expect(
          (await call('post', path, undefined, createBody('x'))).status,
        ).toBe(401);

        // Admin-audience staff and customers are not field employees.
        expect((await call('get', path, tok.hr)).status).toBe(403);
        expect((await call('get', path, tok.customer)).status).toBe(403);

        // The right role on the wrong audience is refused as well (employee surface needs the EMPLOYEE audience).
        const wrongAudience = tokens.signAccessToken(
          ids.empA,
          [Role.FIELD_EXECUTIVE],
          SessionAudience.STAFF,
        );
        expect((await call('get', path, wrongAudience)).status).toBe(403);

        // FIELD_EXECUTIVE role but no employee profile row: refused, never an implicit profile.
        const orphan = await prisma.user.create({
          data: {
            email: `fo-${run}-orphan@example.test`,
            status: UserStatus.ACTIVE,
          },
        });
        await prisma.userRole.create({
          data: { userId: orphan.id, role: Role.FIELD_EXECUTIVE, salonId: null },
        });
        const orphanToken = tokens.signAccessToken(
          orphan.id,
          [Role.FIELD_EXECUTIVE],
          SessionAudience.EMPLOYEE,
        );
        const res = await call('get', path, orphanToken);
        expect(res.status).toBe(403);
        expect(
          await prisma.employeeProfile.count({ where: { userId: orphan.id } }),
        ).toBe(0);
      });

      it('blocks a suspended employee immediately, even with an access token issued before the suspension', async () => {
        await provisionEmployee('empSusp');
        const own = await lead('empSusp', `Suspended Lead ${run}`);
        expect(
          (await call('get', logsPath(own.id), tok.empSusp)).status,
        ).toBe(200);

        const profile = await prisma.employeeProfile.findUniqueOrThrow({
          where: { employeeCode: codes.empSusp },
        });
        const suspend = await call(
          'patch',
          `admin/employees/${profile.id}`,
          tok.hr,
          { status: 'SUSPENDED' },
        );
        expect(suspend.status).toBe(200);

        const after = await call('get', logsPath(own.id), tok.empSusp);
        expect([401, 403]).toContain(after.status);
        expect(
          (await call('post', logsPath(own.id), tok.empSusp, createBody('s')))
            .status,
        ).toBeGreaterThanOrEqual(401);
        expect(
          await prisma.employeeVoiceVisitLog.count({
            where: { leadId: own.id },
          }),
        ).toBe(0);
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('ownership (an employee only ever sees and changes their own leads and notes)', () => {
      it('hides another employee’s lead and notes on every verb, as 404 with no leakage', async () => {
        const mine = await lead('empA', `Owned By A ${run}`);
        const saved = await call(
          'post',
          logsPath(mine.id),
          tok.empA,
          createBody('Owned By A'),
        );
        expect(saved.status).toBe(201);

        const list = await call('get', logsPath(mine.id), tok.empB);
        expect(list.status).toBe(404);
        expect(JSON.stringify(list.body)).not.toContain('Owned By A');

        expect(
          (await call('post', logsPath(mine.id), tok.empB, createBody('Hijack')))
            .status,
        ).toBe(404);
        expect(
          (
            await call(
              'patch',
              `${logsPath(mine.id)}/${saved.body.id}`,
              tok.empB,
              confirmBody(saved.body),
            )
          ).status,
        ).toBe(404);

        // Nothing was written by the refused calls, and A's own row is untouched.
        const row = await prisma.employeeVoiceVisitLog.findUniqueOrThrow({
          where: { id: saved.body.id },
        });
        expect(row.status).toBe('DRAFT');
        expect(
          await prisma.employeeVoiceVisitLog.count({
            where: { leadId: mine.id },
          }),
        ).toBe(1);
      });

      it('does not let a note be reached through a different lead, even one the caller owns', async () => {
        const leadOne = await lead('empA', `Path One ${run}`);
        const leadTwo = await lead('empA', `Path Two ${run}`);
        const saved = await call(
          'post',
          logsPath(leadOne.id),
          tok.empA,
          createBody('Path One'),
        );
        expect(saved.status).toBe(201);
        const crossed = await call(
          'patch',
          `${logsPath(leadTwo.id)}/${saved.body.id}`,
          tok.empA,
          confirmBody(saved.body),
        );
        expect(crossed.status).toBe(404);
        expect(
          (
            await prisma.employeeVoiceVisitLog.findUniqueOrThrow({
              where: { id: saved.body.id },
            })
          ).status,
        ).toBe('DRAFT');
      });

      it('enforces the owner/lead pairing in the database, not only in the service', async () => {
        const mine = await lead('empA', `Fk Guard ${run}`);
        const profileB = await prisma.employeeProfile.findUniqueOrThrow({
          where: { employeeCode: codes.empB },
        });
        await expect(
          prisma.employeeVoiceVisitLog.create({
            data: {
              employeeProfileId: profileB.id,
              leadId: mine.id,
              transcript: 'cross-owner write',
              structuredDraft: draft('x'),
              language: 'en-IN',
            },
          }),
        ).rejects.toThrow();
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('voice note lifecycle', () => {
      it('saves a draft idempotently, edits it, requires acknowledgment, confirms once, then freezes it', async () => {
        const own = await lead('empA', `Lifecycle ${run}`);
        const body = createBody('Lifecycle Shop');

        const first = await call('post', logsPath(own.id), tok.empA, body);
        expect(first.status).toBe(201);
        expect(first.body).toMatchObject({
          status: 'DRAFT',
          confirmedAt: null,
          leadId: own.id,
        });
        expect(first.body.employee.employeeCode).toBe(codes.empA);

        // Same submission key + same content is a replay, not a second note.
        const replay = await call('post', logsPath(own.id), tok.empA, body);
        expect([200, 201]).toContain(replay.status);
        expect(replay.body.id).toBe(first.body.id);
        // Same key, different content is a conflict.
        const reused = await call('post', logsPath(own.id), tok.empA, {
          ...body,
          transcript: 'different words',
        });
        expect(reused.status).toBe(409);
        expect(reused.body.error.code).toBe('EMPLOYEE_VOICE_VISIT_LOG_CONFLICT');
        expect(
          await prisma.employeeVoiceVisitLog.count({
            where: { leadId: own.id },
          }),
        ).toBe(1);

        // Draft edit.
        const edited = await call(
          'patch',
          `${logsPath(own.id)}/${first.body.id}`,
          tok.empA,
          {
            transcript: 'edited transcript',
            language: 'en-IN',
            structuredDraft: draft('Lifecycle Shop', { chairs: 5 }),
            status: 'DRAFT',
          },
        );
        expect(edited.status).toBe(200);
        expect(edited.body.structuredDraft.chairs).toBe(5);
        expect(edited.body.status).toBe('DRAFT');

        // Confirmation needs an explicit acknowledgment of the extracted details.
        const noAck = await call(
          'patch',
          `${logsPath(own.id)}/${first.body.id}`,
          tok.empA,
          confirmBody(edited.body, { reviewAcknowledged: undefined }),
        );
        expect(noAck.status).toBe(400);
        const falseAck = await call(
          'patch',
          `${logsPath(own.id)}/${first.body.id}`,
          tok.empA,
          confirmBody(edited.body, { reviewAcknowledged: false }),
        );
        expect(falseAck.status).toBe(400);
        expect(
          (
            await prisma.employeeVoiceVisitLog.findUniqueOrThrow({
              where: { id: first.body.id },
            })
          ).status,
        ).toBe('DRAFT');

        const confirmed = await call(
          'patch',
          `${logsPath(own.id)}/${first.body.id}`,
          tok.empA,
          confirmBody(edited.body),
        );
        expect(confirmed.status).toBe(200);
        expect(confirmed.body.status).toBe('CONFIRMED');
        expect(confirmed.body.confirmedAt).toEqual(expect.any(String));

        // Idempotent re-confirm returns the same row; a changed payload is refused; nothing mutates.
        const again = await call(
          'patch',
          `${logsPath(own.id)}/${first.body.id}`,
          tok.empA,
          confirmBody(edited.body),
        );
        expect(again.status).toBe(200);
        expect(again.body.confirmedAt).toBe(confirmed.body.confirmedAt);
        const tamper = await call(
          'patch',
          `${logsPath(own.id)}/${first.body.id}`,
          tok.empA,
          confirmBody(edited.body, { transcript: 'rewritten after confirm' }),
        );
        expect(tamper.status).toBe(409);
        const row = await prisma.employeeVoiceVisitLog.findUniqueOrThrow({
          where: { id: first.body.id },
        });
        expect(row.transcript).toBe('edited transcript');

        // Exactly one audit row per transition, with no free-text transcript in it.
        const audits = await prisma.auditLog.findMany({
          where: {
            entityType: 'EmployeeVoiceVisitLog',
            entityId: first.body.id,
          },
        });
        expect(audits.map((a) => a.action).sort()).toEqual([
          'EMPLOYEE_VOICE_VISIT_CONFIRMED',
          'EMPLOYEE_VOICE_VISIT_DRAFT_SAVED',
        ]);
        expect(JSON.stringify(audits)).not.toContain('edited transcript');
      });

      it('pages a history newest-first with a stable cursor, and refuses a forged cursor', async () => {
        const own = await lead('empA', `Paging ${run}`);
        const created: string[] = [];
        for (let i = 0; i < 5; i++) {
          const res = await call(
            'post',
            logsPath(own.id),
            tok.empA,
            createBody(`Paging ${i}`),
          );
          expect(res.status).toBe(201);
          created.push(res.body.id);
        }
        const seen: string[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 5; page++) {
          const res: request.Response = await call(
            'get',
            `${logsPath(own.id)}?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
            tok.empA,
          );
          expect(res.status).toBe(200);
          seen.push(...res.body.items.map((i: Json) => i.id));
          cursor = res.body.nextCursor;
          if (!cursor) break;
        }
        expect(new Set(seen).size).toBe(5);
        expect(seen.sort()).toEqual([...created].sort());

        const forged = await call(
          'get',
          `${logsPath(own.id)}?cursor=${encodeURIComponent('bm90LWEtY3Vyc29y')}`,
          tok.empA,
        );
        expect(forged.status).toBe(400);
        expect(forged.body.error.code).toBe(
          'EMPLOYEE_VOICE_VISIT_LOG_INVALID_CURSOR',
        );
        expect(
          (await call('get', `${logsPath(own.id)}?limit=500`, tok.empA)).status,
        ).toBe(400);
      });

      it('never writes the approved shop catalog (a confirmed note changes no salon or service)', async () => {
        const own = await lead('empA', `Catalog ${run}`);
        const salonsBefore = await prisma.salon.count();
        const servicesBefore = await prisma.service.count();
        const saved = await call(
          'post',
          logsPath(own.id),
          tok.empA,
          createBody('Catalog Shop'),
        );
        await call(
          'patch',
          `${logsPath(own.id)}/${saved.body.id}`,
          tok.empA,
          confirmBody(saved.body),
        );
        expect(await prisma.salon.count()).toBe(salonsBefore);
        expect(await prisma.service.count()).toBe(servicesBefore);
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('concurrency', () => {
      it('collapses parallel creates with one submission key into exactly one note', async () => {
        const own = await lead('empA', `Race Create ${run}`);
        const body = createBody('Race Create');
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            call('post', logsPath(own.id), tok.empA, body),
          ),
        );
        for (const res of results) expect([200, 201]).toContain(res.status);
        expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
        expect(
          await prisma.employeeVoiceVisitLog.count({
            where: { leadId: own.id },
          }),
        ).toBe(1);
        // One audit row for the single creation.
        expect(
          await prisma.auditLog.count({
            where: {
              entityType: 'EmployeeVoiceVisitLog',
              entityId: results[0].body.id,
            },
          }),
        ).toBe(1);
      });

      it('confirms once when confirmations race, and a competing edit can never land after confirmation', async () => {
        const own = await lead('empA', `Race Confirm ${run}`);
        const saved = await call(
          'post',
          logsPath(own.id),
          tok.empA,
          createBody('Race Confirm'),
        );
        const path = `${logsPath(own.id)}/${saved.body.id}`;
        const confirm = confirmBody(saved.body);
        const edit = {
          transcript: 'late edit',
          language: 'en-IN',
          structuredDraft: draft('Race Confirm', { chairs: 9 }),
          status: 'DRAFT',
        };

        const results = await Promise.all([
          call('patch', path, tok.empA, confirm),
          call('patch', path, tok.empA, confirm),
          call('patch', path, tok.empA, confirm),
          call('patch', path, tok.empA, edit),
          call('patch', path, tok.empA, edit),
        ]);
        for (const res of results) expect([200, 409]).toContain(res.status);

        const row = await prisma.employeeVoiceVisitLog.findUniqueOrThrow({
          where: { id: saved.body.id },
        });
        expect(row.status).toBe('CONFIRMED');
        expect(row.confirmedAt).not.toBeNull();
        // Exactly one confirmation audit, however many requests raced.
        expect(
          await prisma.auditLog.count({
            where: {
              entityType: 'EmployeeVoiceVisitLog',
              entityId: saved.body.id,
              action: 'EMPLOYEE_VOICE_VISIT_CONFIRMED',
            },
          }),
        ).toBe(1);
        // Whatever was stored is exactly one of the two submitted versions, never a blend, and it is frozen now.
        const frozen = { transcript: row.transcript, draft: row.structuredDraft };
        const later = await call('patch', path, tok.empA, edit);
        expect(later.status).toBe(409);
        const after = await prisma.employeeVoiceVisitLog.findUniqueOrThrow({
          where: { id: saved.body.id },
        });
        expect({ transcript: after.transcript, draft: after.structuredDraft })
          .toEqual(frozen);
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('onboarding and shop ownership', () => {
      async function makeShop(label: string) {
        const city = await prisma.city.findFirst({ select: { id: true } });
        if (!city) throw new Error('Disposable migration fixture has no city.');
        const owner = await makeUser(
          `owner-${label}`,
          Role.CUSTOMER,
          SessionAudience.CUSTOMER,
        );
        const salon = await prisma.salon.create({
          data: {
            ownerUserId: owner.id,
            name: `FO Shop ${label} ${run}`,
            slug: `fo-${label}-${run}`,
            cityId: city.id,
            addressLine: 'Synthetic test address',
            status: 'ACTIVE',
            currency: 'INR',
          },
        });
        await prisma.userRole.create({
          data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id },
        });
        return { owner, salon };
      }

      it('lets an employee see the shop details of a shop THEY onboarded - and nothing else (owner issue #28)', async () => {
        const { salon, owner } = await makeShop('shopdetail');
        await prisma.salon.update({
          where: { id: salon.id },
          data: { phone: '+919812345678', showPhoneToCustomers: true, localityText: 'Boring Road' },
        });
        await prisma.photo.createMany({
          data: [
            { salonId: salon.id, url: 'https://img.example.test/gallery-2.jpg', type: 'GALLERY', sortOrder: 2 },
            { salonId: salon.id, url: 'https://img.example.test/cover.jpg', type: 'COVER', sortOrder: 0, altText: 'Shop front' },
          ],
        });
        await prisma.chair.createMany({
          data: [
            { salonId: salon.id, label: 'Chair 1', status: 'ACTIVE' },
            { salonId: salon.id, label: 'Chair 2', status: 'INACTIVE' },
            { salonId: salon.id, label: 'Chair 3', status: 'ACTIVE' },
          ],
        });
        const mine = await lead('empA', `Shop Detail Lead ${run}`);
        await prisma.employeeCrmLead.update({
          where: { id: mine.id as string },
          data: { onboardedSalonId: salon.id, onboardedAt: new Date(), status: 'ONBOARDED' },
        });

        const res = await call('get', `employee/leads/${mine.id}/shop`, tok.empA);
        expect(res.status).toBe(200);
        expect(res.body.onboarded).toBe(true);
        expect(res.body.shop).toMatchObject({
          salonId: salon.id,
          name: `FO Shop shopdetail ${run}`,
          status: 'ACTIVE',
          addressLine: 'Synthetic test address',
          localityText: 'Boring Road',
          businessPhone: '+919812345678',
          chairCounts: { total: 3, active: 2 },
        });
        expect(res.body.shop.publicPath).toMatch(/^\/[a-z]{2}\/[a-z0-9-]+\/fo-shopdetail-/);
        // Photos are the shop's real ones, in display order (cover first).
        expect(res.body.shop.photos.map((p: { url: string }) => p.url)).toEqual([
          'https://img.example.test/cover.jpg',
          'https://img.example.test/gallery-2.jpg',
        ]);
        expect(res.body.shop.photos[0].altText).toBe('Shop front');
        expect(res.body.shop.chairs.map((c: { label: string }) => c.label)).toEqual(['Chair 1', 'Chair 2', 'Chair 3']);
        // Nothing about the owner's account, money or customers leaves with it.
        const raw = JSON.stringify(res.body);
        expect(raw).not.toContain(owner.id);
        expect(raw).not.toMatch(/ownerUserId|email|revenue|customer|queue|booking/i);

        // The owner can hide the business phone from this view too.
        await prisma.salon.update({ where: { id: salon.id }, data: { showPhoneToCustomers: false } });
        const hidden = await call('get', `employee/leads/${mine.id}/shop`, tok.empA);
        expect(hidden.body.shop.businessPhone).toBeNull();

        // Another employee cannot read it, and learns nothing: same answer as a lead that does not exist.
        const other = await call('get', `employee/leads/${mine.id}/shop`, tok.empB);
        expect(other.status).toBe(404);
        const missing = await call('get', `employee/leads/${randomUUID()}/shop`, tok.empA);
        expect(missing.status).toBe(404);
        expect(other.body.error?.code).toBe(missing.body.error?.code);

        // A lead that was never onboarded has no shop: an honest empty answer, nothing invented.
        const fresh = await lead('empA', `Not Onboarded ${run}`);
        const none = await call('get', `employee/leads/${fresh.id}/shop`, tok.empA);
        expect(none.status).toBe(200);
        expect(none.body).toEqual({ leadId: fresh.id, onboarded: false, shop: null });

        // Roles: a customer is refused, and nobody anonymous gets in.
        expect((await call('get', `employee/leads/${mine.id}/shop`, tok.customer)).status).toBe(403);
        expect((await call('get', `employee/leads/${mine.id}/shop`)).status).toBe(401);
      });

      it('attributes a shop to the employee’s own lead without touching who owns the shop', async () => {
        const { owner, salon } = await makeShop('one');
        const own = await lead('empA', `Onboard One ${run}`);
        const note = await call(
          'post',
          logsPath(own.id),
          tok.empA,
          createBody('Onboard One'),
        );
        expect(note.status).toBe(201);

        // Another employee cannot onboard this lead, and the refusal changes nothing.
        const foreign = await call(
          'post',
          `employee/leads/${own.id}/onboard`,
          tok.empB,
          { salonPublicId: salon.publicId },
        );
        expect(foreign.status).toBe(404);
        expect(
          (
            await prisma.employeeCrmLead.findUniqueOrThrow({
              where: { id: own.id },
            })
          ).onboardedSalonId,
        ).toBeNull();

        const ownerRoles = async () =>
          (await prisma.userRole.findMany({ where: { userId: owner.id } }))
            .map((r) => `${r.role}:${r.salonId}`)
            .sort();
        const rolesBefore = await ownerRoles();
        expect(rolesBefore).toContain(`${Role.SALON_OWNER}:${salon.id}`);

        const onboarded = await call(
          'post',
          `employee/leads/${own.id}/onboard`,
          tok.empA,
          { salonPublicId: salon.publicId },
        );
        expect(onboarded.status).toBe(201);
        expect(onboarded.body.status).toBe('ONBOARDED');
        expect(onboarded.body.onboardedSalon.publicId).toBe(salon.publicId);

        // Shop ownership is untouched by the attribution: same owner, same owner roles.
        const after = await prisma.salon.findUniqueOrThrow({
          where: { id: salon.id },
        });
        expect(after.ownerUserId).toBe(owner.id);
        expect(await ownerRoles()).toEqual(rolesBefore);
        expect(
          await prisma.userRole.count({
            where: { userId: ids.empA, salonId: salon.id },
          }),
        ).toBe(0);

        // The field notes survive onboarding and stay readable by their employee only.
        const list = await call('get', logsPath(own.id), tok.empA);
        expect(list.status).toBe(200);
        expect(list.body.items.map((i: Json) => i.id)).toContain(note.body.id);

        // A shop can be attributed to one lead only, whoever asks.
        const second = await lead('empB', `Onboard Dup ${run}`);
        const dup = await call(
          'post',
          `employee/leads/${second.id}/onboard`,
          tok.empB,
          { salonPublicId: salon.publicId },
        );
        expect(dup.status).toBe(409);
        expect(dup.body.error.code).toBe('SALON_ALREADY_ATTRIBUTED');
        // And an unknown Shop ID is not guessable into an attribution.
        const unknown = await call(
          'post',
          `employee/leads/${second.id}/onboard`,
          tok.empB,
          { salonPublicId: 'BC-SHOP-999999' },
        );
        expect(unknown.status).toBe(404);
      });

      it('lets a confirmed note exist on an onboarded lead and keeps the attribution immutable', async () => {
        const { salon } = await makeShop('two');
        const own = await lead('empA', `Onboard Two ${run}`);
        const note = await call(
          'post',
          logsPath(own.id),
          tok.empA,
          createBody('Onboard Two'),
        );
        await call(
          'post',
          `employee/leads/${own.id}/onboard`,
          tok.empA,
          { salonPublicId: salon.publicId },
        );
        const confirmed = await call(
          'patch',
          `${logsPath(own.id)}/${note.body.id}`,
          tok.empA,
          confirmBody(note.body),
        );
        expect(confirmed.status).toBe(200);
        // Re-onboarding the same shop is idempotent; a different shop is refused.
        const same = await call(
          'post',
          `employee/leads/${own.id}/onboard`,
          tok.empA,
          { salonPublicId: salon.publicId },
        );
        expect(same.status).toBe(201);
        const other = await makeShop('three');
        const swap = await call(
          'post',
          `employee/leads/${own.id}/onboard`,
          tok.empA,
          { salonPublicId: other.salon.publicId },
        );
        expect(swap.status).toBe(409);
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('existing employee compatibility', () => {
      it('keeps a pre-existing employee, lead, visit and follow-up working unchanged after the migrations', async () => {
        // A legacy employee as production holds them: profile + CRM rows created without any voice-note data.
        const user = await prisma.user.create({
          data: {
            passwordHash: (
              await prisma.user.findFirstOrThrow({
                where: { id: ids.empA },
                select: { passwordHash: true },
              })
            ).passwordHash,
            status: UserStatus.ACTIVE,
          },
        });
        await prisma.userRole.create({
          data: { userId: user.id, role: Role.FIELD_EXECUTIVE, salonId: null },
        });
        const code = `FQ-FE-${String(80000 + (parseInt(run, 16) % 9000)).padStart(5, '0')}`;
        const profile = await prisma.employeeProfile.create({
          data: { userId: user.id, employeeCode: code, fullName: `Legacy ${run}` },
        });
        const legacyLead = await prisma.employeeCrmLead.create({
          data: {
            employeeProfileId: profile.id,
            shopName: `Legacy Lead ${run}`,
          },
        });
        const legacy = await authService.employeeLogin(code, PASSWORD);
        const token = legacy.tokens.accessToken;

        const me = await call('get', 'employee/me', token);
        expect(me.status).toBe(200);
        const dash = await call('get', 'employee/dashboard', token);
        expect(dash.status).toBe(200);
        const leads = await call('get', 'employee/leads', token);
        expect(leads.status).toBe(200);
        expect(JSON.stringify(leads.body)).toContain(`Legacy Lead ${run}`);

        // Legacy verbs still work, and the new notes attach to the legacy lead.
        const visit = await call('post', 'employee/visits', token, {
          leadId: legacyLead.id,
          shopName: legacyLead.shopName,
          outcome: 'CONTACTED',
        });
        expect(visit.status).toBe(201);
        const patched = await call(
          'patch',
          `employee/leads/${legacyLead.id}`,
          token,
          { notes: 'updated by the legacy flow' },
        );
        expect(patched.status).toBe(200);
        const note = await call(
          'post',
          logsPath(legacyLead.id),
          token,
          createBody('Legacy Lead'),
        );
        expect(note.status).toBe(201);

        // Employee identity is not altered: same code, same user, same role set.
        const stored = await prisma.employeeProfile.findUniqueOrThrow({
          where: { id: profile.id },
        });
        expect(stored.employeeCode).toBe(code);
        expect(stored.userId).toBe(user.id);
        expect(
          (await prisma.userRole.findMany({ where: { userId: user.id } })).map(
            (r) => r.role,
          ),
        ).toEqual([Role.FIELD_EXECUTIVE]);
      });

      it('serves the employee login route over HTTP with the same credentials', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/employee/login')
          .send({ employeeCode: codes.empA, password: PASSWORD });
        expect(res.status).toBe(201);
        expect(res.body.tokens?.accessToken ?? res.body.accessToken).toEqual(
          expect.any(String),
        );
      });
    });
  },
);
