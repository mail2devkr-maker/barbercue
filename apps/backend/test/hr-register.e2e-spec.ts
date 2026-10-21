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
import { TotpService } from '../src/auth/services/totp.service';
import { CryptoService } from '../src/auth/services/crypto.service';
import { AuthService } from '../src/auth/auth.service';

/**
 * HR permanent employee-ID register (issue #283): the REAL AppModule, real Prisma, real PostgreSQL, real JWT and
 * roles guards, with synthetic people only. SAFETY: it creates data, so it refuses to run on anything but a local
 * database, and it only ever reads rows it created (every fixture carries this run's unique tag).
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = LOCAL_DB ? describe : describe.skip;

type Json = Record<string, any>;

maybe(
  'HR permanent employee-ID register (e2e, disposable local database)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokens: TokenService;
    let totp: TotpService;
    let crypto: CryptoService;
    let authService: AuthService;

    const run = randomUUID().slice(0, 8);
    const tok: Record<string, string> = {};
    const ids: Record<string, string> = {};
    let counter = 0;
    const email = (label: string) => `hr-${run}-${label}@example.test`;
    const phone = () =>
      `9${String(parseInt(run, 16) % 100_000).padStart(5, '0')}${String(1000 + ++counter).slice(-4)}`;

    const call = (
      method: 'get' | 'post' | 'patch',
      path: string,
      token?: string,
      body?: unknown,
      key?: string,
    ) => {
      const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
      if (token) req.set('Authorization', `Bearer ${token}`);
      if (method !== 'get') req.set('Idempotency-Key', key ?? randomUUID());
      return body === undefined ? req : req.send(body as object);
    };

    async function makeAdmin(
      label: string,
      role: Role,
      audience: SessionAudience = SessionAudience.ADMIN,
      extra: Record<string, unknown> = {},
    ) {
      const user = await prisma.user.create({
        data: {
          email: email(label),
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
          ...extra,
        },
      });
      await prisma.userRole.create({
        data: { userId: user.id, role, salonId: null },
      });
      ids[label] = user.id;
      tok[label] = tokens.signAccessToken(user.id, [role], audience);
      return user;
    }

    const TERMS = (over: Json = {}) => ({
      role: 'Field Sales Executive',
      baseSalaryInr: 24000,
      salaryBasis: 'monthly',
      salesTarget: null,
      incentiveBeyondTargetInr: null,
      proposedJoiningDate: null,
      reportingManagerId: null,
      city: 'Patna',
      ...over,
    });

    async function match(label: string, query: Json) {
      const res = await call(
        'post',
        'admin/hr/identity/matches',
        tok[label],
        query,
      );
      expect(res.status).toBe(201);
      return res.body as Json;
    }

    /** Full new-candidate flow as HR: identity check, then save. Returns the created offer + person. */
    async function newCandidate(
      name: string,
      opts: {
        contactLabel?: string;
        terms?: Json;
        admin?: string;
        overrideReason?: string;
        expectStatus?: number;
      } = {},
    ) {
      const admin = opts.admin ?? 'hr';
      const contact = {
        fullName: name,
        email: email(opts.contactLabel ?? `c${++counter}`),
        phone: phone(),
      };
      const reviewed = await match(admin, contact);
      const res = await call('post', 'admin/hr/offers', tok[admin], {
        identity: {
          mode: 'NEW',
          person: contact,
          decisionToken: reviewed.decisionToken,
          ...(opts.overrideReason
            ? { overrideReason: opts.overrideReason }
            : {}),
        },
        terms: TERMS(opts.terms),
      });
      if (opts.expectStatus) expect(res.status).toBe(opts.expectStatus);
      else expect(res.status).toBe(201);
      return { res, contact, body: res.body as Json };
    }

    /** Re-offer / rehire an EXISTING person (identity checked by exact code, as the web UI does). */
    async function offerExisting(
      admin: string,
      person: Json,
      terms: Json = {},
    ) {
      const reviewed = await match(admin, {
        employeeCode: person.employeeCode,
      });
      return call('post', 'admin/hr/offers', tok[admin], {
        identity: {
          mode: 'EXISTING',
          personId: person.id,
          decisionToken: reviewed.decisionToken,
        },
        terms: TERMS(terms),
      });
    }

    const status = (
      admin: string,
      offerId: string,
      to: string,
      reason?: string,
    ) =>
      call('post', `admin/hr/offers/${offerId}/status`, tok[admin], {
        to,
        ...(reason ? { reason } : {}),
      });
    const today = new Date(Date.now() + 5.5 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const daysAgo = (n: number) =>
      new Date(Date.now() + 5.5 * 3_600_000 - n * 86_400_000)
        .toISOString()
        .slice(0, 10);
    const join = (
      admin: string,
      offerId: string,
      joinedOn: string,
      password = 'Synthetic-Pass-1',
    ) =>
      call('post', `admin/hr/offers/${offerId}/joining`, tok[admin], {
        joinedOn,
        temporaryPassword: password,
        territory: 'Patna',
      });
    const getPerson = async (admin: string, id: string) =>
      (await call('get', `admin/hr/persons/${id}`, tok[admin])).body as Json;
    /** One real HTTP login proves the public endpoint; the rest go through the same service (the route is rate limited). */
    const employeeLogin = (code: string, password: string) =>
      request(app.getHttpServer())
        .post('/api/v1/auth/employee/login')
        .send({ employeeCode: code, password });
    const canLogin = (code: string, password: string): Promise<boolean> =>
      authService.employeeLogin(code, password).then(
        () => true,
        () => false,
      );

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api/v1');
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      // One listening server shared by every request: parallel supertest calls must not each bind their own.
      await app.listen(0);
      prisma = app.get(PrismaService);
      tokens = app.get(TokenService);
      totp = app.get(TotpService);
      crypto = app.get(CryptoService);
      authService = app.get(AuthService);

      await makeAdmin('hr', Role.HR_ADMIN);
      await makeAdmin('hr2', Role.HR_ADMIN);
      await makeAdmin('cofounder', Role.CO_FOUNDER);
      await makeAdmin('sales', Role.SALES_ADMIN);
      await makeAdmin('viewer', Role.PLATFORM_VIEWER);
      await makeAdmin('customer', Role.CUSTOMER, SessionAudience.CUSTOMER);
      await makeAdmin('hrStaffAudience', Role.HR_ADMIN, SessionAudience.STAFF);
      const secret = totp.generateSecret();
      ids.platformSecret = secret;
      await makeAdmin('platform', Role.PLATFORM_ADMIN, SessionAudience.ADMIN, {
        twoFactorEnabled: true,
        totpSecret: crypto.encrypt(secret),
      });
    });

    afterAll(async () => {
      await app?.close();
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('authorization', () => {
      it('rejects anonymous callers with 401 and every non-HR role or audience with 403', async () => {
        expect((await call('get', 'admin/hr/register')).status).toBe(401);
        for (const label of [
          'customer',
          'sales',
          'viewer',
          'hrStaffAudience',
        ]) {
          expect(
            (await call('get', 'admin/hr/register', tok[label])).status,
          ).toBe(403);
          expect(
            (
              await call('post', 'admin/hr/identity/matches', tok[label], {
                fullName: 'Nobody Here',
              })
            ).status,
          ).toBe(403);
        }
        for (const label of ['hr', 'cofounder', 'platform']) {
          expect(
            (await call('get', 'admin/hr/register', tok[label])).status,
          ).toBe(200);
        }
      });

      it('requires an Idempotency-Key on every mutation', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/admin/hr/offers')
          .set('Authorization', `Bearer ${tok.hr}`)
          .send({});
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('new candidate -> first offer -> permanent ID', () => {
      let alice: Json;
      let aliceContact: Json;

      it('allocates one permanent standard code on the first saved offer and creates NO login', async () => {
        const { body, contact } = await newCandidate(`Alice${run} Newhire`, {
          terms: { proposedJoiningDate: '2026-12-01' },
        });
        alice = body.person;
        aliceContact = contact;
        expect(alice.employeeCode).toMatch(/^FQ-FE-\d{5}$/);
        expect(Number(alice.employeeCode.slice(6))).toBeGreaterThanOrEqual(101);
        expect(body.offer).toMatchObject({
          version: 1,
          kind: 'FIRST',
          status: 'ISSUED',
          source: 'REGISTER',
        });
        expect(body.offer.terms.expectedPerformanceIncentiveMonthlyInr).toBe(
          5000,
        );
        expect(alice.hasEmployeeAccount).toBe(false);
        expect(alice.employeeProfileId).toBeNull();
        expect(alice.currentEpisode).toMatchObject({
          episodeNumber: 1,
          status: 'PENDING_JOIN',
        });
        // Database truth: a register person exists, no profile / user / role exists for that code.
        const person = await prisma.hrPerson.findUniqueOrThrow({
          where: { employeeCode: alice.employeeCode },
        });
        expect(person.employeeProfileId).toBeNull();
        expect(
          await prisma.employeeProfile.count({
            where: { employeeCode: alice.employeeCode },
          }),
        ).toBe(0);
      });

      it('never returns or stores a raw contact: lists show masked values, the database holds only a hash and ciphertext', async () => {
        const detail = await call(
          'get',
          `admin/hr/persons/${alice.id}`,
          tok.hr,
        );
        const text = JSON.stringify(detail.body);
        expect(text).not.toContain(aliceContact.email);
        expect(text).not.toContain(aliceContact.phone);
        expect(detail.body.maskedEmail).toMatch(/^.•+@example\.test$/);
        const row = await prisma.hrPerson.findUniqueOrThrow({
          where: { id: alice.id },
        });
        expect(JSON.stringify(row)).not.toContain(aliceContact.email);
        expect(JSON.stringify(row)).not.toContain(aliceContact.phone);
        expect(row.emailHash).toMatch(/^[0-9a-f]{64}$/);
        const audit = JSON.stringify(
          await prisma.hrAuditEvent.findMany({ where: { personId: alice.id } }),
        );
        expect(audit).not.toContain(aliceContact.email);
      });

      it('a double submit with the same idempotency key is one offer; a stale token cannot create a second person', async () => {
        const contact = {
          fullName: `Bob${run} Doubleclick`,
          email: email('bob'),
          phone: phone(),
        };
        const reviewed = await match('hr', contact);
        const body = {
          identity: {
            mode: 'NEW',
            person: contact,
            decisionToken: reviewed.decisionToken,
          },
          terms: TERMS(),
        };
        const key = randomUUID();
        const [first, second] = await Promise.all([
          call('post', 'admin/hr/offers', tok.hr, body, key),
          call('post', 'admin/hr/offers', tok.hr, body, key),
        ]);
        const winners = [first, second].filter((res) => res.status === 201);
        expect(winners.length).toBeGreaterThanOrEqual(1);
        for (const res of [first, second])
          expect([201, 409]).toContain(res.status); // the racing one is told to retry
        const replay = await call('post', 'admin/hr/offers', tok.hr, body, key);
        expect(replay.status).toBe(201);
        expect(replay.body.offer.id).toBe(winners[0].body.offer.id);
        // Same token, DIFFERENT key: the person now exists, so the authoritative re-check refuses a duplicate.
        const again = await call(
          'post',
          'admin/hr/offers',
          tok.hr,
          body,
          randomUUID(),
        );
        expect(again.status).toBe(409);
        expect(again.body.error.code).toBe('HR_IDENTITY_CONFLICT');
        const people = await prisma.hrPerson.count({
          where: { fullName: contact.fullName },
        });
        expect(people).toBe(1);
        expect(
          await prisma.hrOfferVersion.count({
            where: { person: { fullName: contact.fullName } },
          }),
        ).toBe(1);
      });

      it('reusing a key with a different body is rejected', async () => {
        const key = randomUUID();
        const contact = {
          fullName: `Keyreuse${run} Two`,
          email: email('keyreuse'),
          phone: phone(),
        };
        const reviewed = await match('hr', contact);
        const first = await call(
          'post',
          'admin/hr/offers',
          tok.hr,
          {
            identity: {
              mode: 'NEW',
              person: contact,
              decisionToken: reviewed.decisionToken,
            },
            terms: TERMS(),
          },
          key,
        );
        expect(first.status).toBe(201);
        const second = await call(
          'post',
          'admin/hr/offers',
          tok.hr,
          {
            identity: {
              mode: 'NEW',
              person: contact,
              decisionToken: reviewed.decisionToken,
            },
            terms: TERMS({ baseSalaryInr: 99999 }),
          },
          key,
        );
        expect(second.status).toBe(409);
        expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      });

      it('allocates distinct, gap-free, never-reserved codes under concurrency', async () => {
        const names = [
          'Aarav Zeta',
          'Bhavna Omega',
          'Chetan Sigma',
          'Divya Lambda',
          'Eshan Kappa',
          'Farah Theta',
          'Gaurav Delta',
          'Hema Gamma',
        ];
        const results = await Promise.all(
          names.map((name) => newCandidate(`${name} ${run}`)),
        );
        const codes = results.map(
          (entry) => entry.body.person.employeeCode as string,
        );
        expect(new Set(codes).size).toBe(8);
        const numbers = codes
          .map((code) => Number(code.slice(6)))
          .sort((a, b) => a - b);
        expect(numbers[0]).toBeGreaterThanOrEqual(101);
        expect(numbers[numbers.length - 1] - numbers[0]).toBe(7); // consecutive: nothing skipped, nothing doubled
      });

      it('rejects a tampered, foreign or expired decision token', async () => {
        const contact = {
          fullName: `Tokentest${run} Person`,
          email: email('tok'),
          phone: phone(),
        };
        const reviewed = await match('hr', contact);
        const forged = `${reviewed.decisionToken.slice(0, -4)}AAAA`;
        for (const token of [forged, 'x'.repeat(40)]) {
          const res = await call('post', 'admin/hr/offers', tok.hr, {
            identity: { mode: 'NEW', person: contact, decisionToken: token },
            terms: TERMS(),
          });
          expect(res.status).toBe(409);
          expect(res.body.error.code).toBe('HR_MATCH_REVIEW_REQUIRED');
        }
        // A token minted for one admin cannot be replayed by another.
        const foreign = await call('post', 'admin/hr/offers', tok.hr2, {
          identity: {
            mode: 'NEW',
            person: contact,
            decisionToken: reviewed.decisionToken,
          },
          terms: TERMS(),
        });
        expect(foreign.status).toBe(409);
        // The reviewed details must be the saved details.
        const edited = await call('post', 'admin/hr/offers', tok.hr, {
          identity: {
            mode: 'NEW',
            person: { ...contact, fullName: `Othername${run} Person` },
            decisionToken: reviewed.decisionToken,
          },
          terms: TERMS(),
        });
        expect(edited.status).toBe(409);
        expect(
          await prisma.hrPerson.count({
            where: {
              fullName: { in: [contact.fullName, `Othername${run} Person`] },
            },
          }),
        ).toBe(0);
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('identity matching never merges silently', () => {
      it('flags same name + reused contact, blocks a new identity without a reason, and keeps hard matches senior-only', async () => {
        const first = await newCandidate(`Priya${run} Sharma`, {
          contactLabel: 'priya',
        });
        const sameEmail = {
          fullName: `Priya${run} Sharma`,
          email: first.contact.email,
          phone: phone(),
        };
        const reviewed = await match('hr', sameEmail);
        expect(
          reviewed.matches.map((entry: Json) => entry.person.id),
        ).toContain(first.body.person.id);
        const hit = reviewed.matches.find(
          (entry: Json) => entry.person.id === first.body.person.id,
        );
        expect(hit.reasons).toEqual(
          expect.arrayContaining(['EMAIL', 'NAME_EXACT']),
        );
        expect(hit.strength).toBe('STRONG');
        expect(reviewed.blocksNewIdentity).toBe(true);
        expect(reviewed.overrideRequiresSenior).toBe(true);
        const body = (reason?: string) => ({
          identity: {
            mode: 'NEW',
            person: sameEmail,
            decisionToken: reviewed.decisionToken,
            ...(reason ? { overrideReason: reason } : {}),
          },
          terms: TERMS(),
        });

        const noReason = await call('post', 'admin/hr/offers', tok.hr, body());
        expect(noReason.status).toBe(409);
        expect(noReason.body.error.code).toBe('HR_MATCH_REVIEW_REQUIRED');
        const hrWithReason = await call(
          'post',
          'admin/hr/offers',
          tok.hr,
          body('Different person, same family mailbox'),
        );
        expect(hrWithReason.status).toBe(403);
        expect(hrWithReason.body.error.code).toBe(
          'HR_OVERRIDE_REQUIRES_SENIOR',
        );
        const seniorReview = await match('cofounder', sameEmail);
        const seniorBody = {
          identity: {
            mode: 'NEW',
            person: sameEmail,
            decisionToken: seniorReview.decisionToken,
            overrideReason: 'Verified with documents: different person',
          },
          terms: TERMS(),
        };
        const senior = await call(
          'post',
          'admin/hr/offers',
          tok.cofounder,
          seniorBody,
        );
        expect(senior.status).toBe(201);
        expect(senior.body.person.employeeCode).not.toBe(
          first.body.person.employeeCode,
        );
        const audit = await call(
          'get',
          `admin/hr/persons/${senior.body.person.id}/audit`,
          tok.hr,
        );
        const created = audit.body.items.find(
          (entry: Json) => entry.action === 'IDENTITY_CREATED',
        );
        expect(created.reason).toBe(
          'Verified with documents: different person',
        );
      });

      it('a changed phone with the same name and a similar spelling is only a WEAK, non-merging hint', async () => {
        const first = await newCandidate(`Rahul${run} Verma`, {
          contactLabel: 'rahul',
        });
        const reviewed = await match('hr', {
          fullName: `Rahul${run} Varma`,
          phone: phone(),
        });
        const hit = reviewed.matches.find(
          (entry: Json) => entry.person.id === first.body.person.id,
        );
        expect(hit.reasons).toContain('NAME_SIMILAR');
        expect(hit.strength).toBe('WEAK');
        expect(reviewed.overrideRequiresSenior).toBe(false);
      });

      it('an exact employee code can never produce a second person (database uniqueness)', async () => {
        const first = await newCandidate(`Uniquecode${run} Tester`);
        await expect(
          prisma.hrPerson.create({
            data: {
              employeeCode: first.body.person.employeeCode,
              codeNumber: Number(first.body.person.employeeCode.slice(6)),
              fullName: 'Impostor',
              nameKey: 'impostor',
              nameFirstKey: 'impostor',
              origin: 'OFFER',
            },
          }),
        ).rejects.toThrow();
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('not joined -> returns later -> same ID, no login ever granted before approved joining', () => {
      it('keeps the code across a no-join, reuses it for the re-offer, then creates the single account on joining', async () => {
        const first = await newCandidate(`Meera${run} Noshow`, {
          terms: { baseSalaryInr: 20000, proposedJoiningDate: '2026-05-01' },
        });
        const person = first.body.person;
        const v1 = first.body.offer;

        expect((await status('hr', v1.id, 'SENT')).status).toBe(201);
        expect((await status('hr', v1.id, 'SENT')).status).toBe(409); // cannot "email" twice
        expect((await status('hr', v1.id, 'DECLINED')).status).toBe(400); // reason required
        expect((await status('hr', v1.id, 'ACCEPTED')).status).toBe(201);
        expect((await join('hr', v1.id, '2999-01-01')).status).toBe(422); // not in the future

        const notJoined = await call(
          'post',
          `admin/hr/offers/${v1.id}/not-joined`,
          tok.hr,
          { decidedOn: today, reason: 'Did not report on the joining date' },
        );
        expect(notJoined.status).toBe(201);
        expect(notJoined.body.currentEpisode.status).toBe('NOT_JOINED');
        expect(notJoined.body.hasEmployeeAccount).toBe(false);
        expect(
          await prisma.employeeProfile.count({
            where: { employeeCode: person.employeeCode },
          }),
        ).toBe(0);

        // A year later the same person is re-offered: SAME code, new version and a new episode.
        const second = await offerExisting('hr', person, {
          baseSalaryInr: 26000,
          proposedJoiningDate: '2027-06-01',
        });
        expect(second.status).toBe(201);
        expect(second.body.person.employeeCode).toBe(person.employeeCode);
        expect(second.body.offer).toMatchObject({
          version: 2,
          kind: 'REOFFER',
          status: 'ISSUED',
        });
        const detail = await getPerson('hr', person.id);
        expect(detail.offers[0].supersededByVersion).toBe(2); // v1 is preserved as history, never edited
        expect(detail.offers[0].terms.baseSalaryInr).toBe(20000);
        expect(
          detail.episodes.map((e: Json) => [e.episodeNumber, e.status]),
        ).toEqual([
          [1, 'NOT_JOINED'],
          [2, 'PENDING_JOIN'],
        ]);
        expect(
          await prisma.hrPerson.count({ where: { fullName: person.fullName } }),
        ).toBe(1);

        // A second open offer is refused until the first is resolved.
        expect((await offerExisting('hr', person)).status).toBe(409);

        // Only an approved joining creates the one account; it carries the permanent code.
        const v2 = second.body.offer;
        expect((await join('hr', v2.id, daysAgo(0))).status).toBe(409); // not accepted yet
        expect((await status('hr', v2.id, 'ACCEPTED')).status).toBe(201);
        const joined = await join('hr', v2.id, daysAgo(0), 'Synthetic-Pass-2');
        expect(joined.status).toBe(201);
        expect(joined.body.hasEmployeeAccount).toBe(true);
        const profile = await prisma.employeeProfile.findUniqueOrThrow({
          where: { employeeCode: person.employeeCode },
          include: { user: true },
        });
        expect(profile.user.status).toBe('ACTIVE');
        expect(
          (await employeeLogin(person.employeeCode, 'Synthetic-Pass-2')).status,
        ).toBe(201);
        // The joining is idempotent in effect: a replay of the same joining is refused, not a second account.
        expect(
          (await join('hr', v2.id, daysAgo(0), 'Another-Pass-9')).status,
        ).toBe(409);
        expect(
          await prisma.employeeProfile.count({
            where: { employeeCode: person.employeeCode },
          }),
        ).toBe(1);
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('joined -> exited -> rejoined keeps the same ID, profile and account', () => {
      it('suspends access and revokes sessions on exit, preserves history, and re-enables the SAME account on rehire', async () => {
        const manager = await prisma.employeeProfile.create({
          data: {
            userId: (
              await prisma.user.create({
                data: { email: email('mgr'), status: 'ACTIVE' },
              })
            ).id,
            employeeCode: `FQ-FE-${String(90000 + (parseInt(run, 16) % 9000)).padStart(5, '0')}`,
            fullName: 'Synthetic Manager',
          },
        });
        const first = await newCandidate(`Karan${run} Rehire`, {
          terms: {
            baseSalaryInr: 21000,
            reportingManagerId: manager.id,
            proposedJoiningDate: daysAgo(40),
          },
        });
        const person = first.body.person;
        const v1 = first.body.offer;
        await status('hr', v1.id, 'ACCEPTED');
        const firstJoin = daysAgo(40);
        const joined = await join('hr', v1.id, firstJoin, 'First-Pass-1234');
        expect(joined.status).toBe(201);
        const profileBefore = await prisma.employeeProfile.findUniqueOrThrow({
          where: { employeeCode: person.employeeCode },
        });
        expect(joined.body.salaryHistory).toHaveLength(1);
        expect(joined.body.managerHistory[0]).toMatchObject({
          from: firstJoin,
          to: null,
        });
        expect(joined.body.originalJoinedOn).toBe(firstJoin);

        expect(await canLogin(person.employeeCode, 'First-Pass-1234')).toBe(
          true,
        );
        expect(
          await prisma.refreshToken.count({
            where: { userId: profileBefore.userId, revokedAt: null },
          }),
        ).toBeGreaterThan(0);

        // An active employee cannot be re-offered.
        expect((await offerExisting('hr', joined.body)).status).toBe(409);

        const episodeId = joined.body.currentEpisode.id;
        expect(
          (
            await call('post', `admin/hr/episodes/${episodeId}/exit`, tok.hr, {
              exitedOn: daysAgo(41),
              reason: 'Resigned',
            })
          ).status,
        ).toBe(422); // before joining
        const exitedOn = daysAgo(10);
        const exited = await call(
          'post',
          `admin/hr/episodes/${episodeId}/exit`,
          tok.hr,
          { exitedOn, reason: 'Resigned for relocation' },
        );
        expect(exited.status).toBe(201);
        expect(exited.body.currentEpisode).toMatchObject({
          status: 'EXITED',
          exitedOn,
        });
        expect(
          (
            await prisma.user.findUniqueOrThrow({
              where: { id: profileBefore.userId },
            })
          ).status,
        ).toBe('SUSPENDED');
        expect(
          await prisma.refreshToken.count({
            where: { userId: profileBefore.userId, revokedAt: null },
          }),
        ).toBe(0);
        expect(await canLogin(person.employeeCode, 'First-Pass-1234')).toBe(
          false,
        );
        expect(exited.body.managerHistory[0].to).toBe(exitedOn);
        expect(
          (
            await call('post', `admin/hr/episodes/${episodeId}/exit`, tok.hr, {
              exitedOn,
              reason: 'Resigned again',
            })
          ).status,
        ).toBe(409);

        // Rehire: same code, REHIRE kind, a NEW episode; the profile, user and CRM history are not recreated.
        const secondOffer = await offerExisting('hr', exited.body, {
          baseSalaryInr: 30000,
          reportingManagerId: manager.id,
          proposedJoiningDate: today,
        });
        expect(secondOffer.status).toBe(201);
        expect(secondOffer.body.person.employeeCode).toBe(person.employeeCode);
        expect(secondOffer.body.offer).toMatchObject({
          version: 2,
          kind: 'REHIRE',
        });
        expect(await canLogin(person.employeeCode, 'First-Pass-1234')).toBe(
          false,
        ); // still no access
        await status('hr', secondOffer.body.offer.id, 'ACCEPTED');
        const rejoinDay = daysAgo(0);
        const rejoined = await join(
          'hr',
          secondOffer.body.offer.id,
          rejoinDay,
          'Second-Pass-5678',
        );
        expect(rejoined.status).toBe(201);

        const profileAfter = await prisma.employeeProfile.findUniqueOrThrow({
          where: { employeeCode: person.employeeCode },
        });
        expect(profileAfter.id).toBe(profileBefore.id);
        expect(profileAfter.userId).toBe(profileBefore.userId);
        expect(profileAfter.joinedAt.toISOString()).toBe(
          profileBefore.joinedAt.toISOString(),
        ); // original join untouched
        expect(
          await prisma.employeeProfile.count({
            where: { fullName: person.fullName },
          }),
        ).toBe(1);
        expect(
          (
            await prisma.user.findUniqueOrThrow({
              where: { id: profileBefore.userId },
            })
          ).status,
        ).toBe('ACTIVE');
        expect(await canLogin(person.employeeCode, 'First-Pass-1234')).toBe(
          false,
        ); // old password dead
        expect(await canLogin(person.employeeCode, 'Second-Pass-5678')).toBe(
          true,
        );

        const detail = await getPerson('hr', person.id);
        expect(detail.originalJoinedOn).toBe(firstJoin);
        expect(
          detail.episodes.map((e: Json) => [
            e.episodeNumber,
            e.status,
            e.joinedOn,
          ]),
        ).toEqual([
          [1, 'EXITED', firstJoin],
          [2, 'ACTIVE', rejoinDay],
        ]);
        expect(
          detail.salaryHistory.map((s: Json) => [
            s.baseSalaryInr,
            s.offerVersion,
          ]),
        ).toEqual([
          [21000, 1],
          [30000, 2],
        ]);
        expect(detail.managerHistory.map((m: Json) => [m.from, m.to])).toEqual([
          [firstJoin, exitedOn],
          [rejoinDay, null],
        ]);
        expect(
          detail.offers.map((o: Json) => [
            o.version,
            o.kind,
            o.terms.baseSalaryInr,
          ]),
        ).toEqual([
          [1, 'FIRST', 21000],
          [2, 'REHIRE', 30000],
        ]);
        const audit = (
          await call(
            'get',
            `admin/hr/persons/${person.id}/audit?limit=100`,
            tok.hr,
          )
        ).body.items.map((entry: Json) => entry.action);
        expect(audit).toEqual(
          expect.arrayContaining([
            'IDENTITY_CREATED',
            'OFFER_ISSUED',
            'ACCOUNT_CREATED',
            'JOINED',
            'EXITED',
            'ACCOUNT_REACTIVATED',
            'REJOINED',
          ]),
        );
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('existing employees and the legacy account paths share the one allocator', () => {
      it('adopts a pre-existing profile into the register with its original code and lets HR rehire it with the same ID', async () => {
        const code = `FQ-FE-${String(80000 + (parseInt(run, 16) % 9000)).padStart(5, '0')}`;
        const user = await prisma.user.create({
          data: {
            email: email('legacy'),
            status: 'SUSPENDED',
            passwordHash: 'x',
          },
        });
        const profile = await prisma.employeeProfile.create({
          data: {
            userId: user.id,
            employeeCode: code,
            fullName: `Legacy Staff ${run}`,
          },
        });
        const list = await call(
          'get',
          `admin/hr/register?employeeCode=${code}`,
          tok.hr,
        );
        expect(list.body.total).toBe(1);
        const person = list.body.items[0];
        expect(person).toMatchObject({
          employeeCode: code,
          origin: 'EXISTING_PROFILE',
          employeeProfileId: profile.id,
          offerCount: 0,
        });
        expect(person.currentEpisode.status).toBe('EXITED'); // suspended account is never invented as "joined"

        const offer = await offerExisting('hr', person, {
          baseSalaryInr: 18000,
        });
        expect(offer.status).toBe(201);
        expect(offer.body.offer).toMatchObject({ version: 1, kind: 'REHIRE' });
        await status('hr', offer.body.offer.id, 'ACCEPTED');
        expect(
          (await join('hr', offer.body.offer.id, daysAgo(0), 'Legacy-Pass-1'))
            .status,
        ).toBe(201);
        const after = await prisma.employeeProfile.findUniqueOrThrow({
          where: { employeeCode: code },
        });
        expect(after.id).toBe(profile.id);
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
            .status,
        ).toBe('ACTIVE');
      });

      it('treats a legacy-suspended ACTIVE employee as left when HR issues a new offer', async () => {
        const code = `FQ-FE-${String(70000 + (parseInt(run, 16) % 9000)).padStart(5, '0')}`;
        const user = await prisma.user.create({
          data: {
            email: email('legacy2'),
            status: 'ACTIVE',
            passwordHash: 'x',
          },
        });
        await prisma.employeeProfile.create({
          data: {
            userId: user.id,
            employeeCode: code,
            fullName: `Legacy Two ${run}`,
          },
        });
        const person = (
          await call('get', `admin/hr/register?employeeCode=${code}`, tok.hr)
        ).body.items[0];
        expect(person.currentEpisode.status).toBe('ACTIVE');
        expect((await offerExisting('hr', person)).status).toBe(409); // still employed
        await prisma.user.update({
          where: { id: user.id },
          data: { status: 'SUSPENDED' },
        }); // legacy Employees-page deactivate
        const offer = await offerExisting('hr', person);
        expect(offer.status).toBe(201);
        expect(offer.body.offer.kind).toBe('REHIRE');
        const audit = (
          await call('get', `admin/hr/persons/${person.id}/audit`, tok.hr)
        ).body.items.map((e: Json) => e.action);
        expect(audit).toContain('EXITED_ON_SUSPENDED_ACCOUNT');
      });

      it('direct account creation draws from the same sequence and never takes an ID pending in the register', async () => {
        const pending = await newCandidate(`Pendingholder${run} Tester`);
        const pendingNumber = Number(pending.body.person.employeeCode.slice(6));
        const created = await call('post', 'admin/employees', tok.platform, {
          fullName: `Direct Account ${run}`,
          territory: 'Delhi',
          password: 'Direct-Pass-123',
          confirmPassword: 'Direct-Pass-123',
        });
        expect(created.status).toBe(201);
        const directNumber = Number(created.body.employeeCode.slice(6));
        expect(directNumber).toBeGreaterThan(pendingNumber);
        expect(created.body.employeeCode).not.toBe(
          pending.body.person.employeeCode,
        );
        const registered = await call(
          'get',
          `admin/hr/register?employeeCode=${created.body.employeeCode}`,
          tok.hr,
        );
        expect(registered.body.items[0]).toMatchObject({
          origin: 'DIRECT_ACCOUNT',
          hasEmployeeAccount: true,
        });
        expect(registered.body.items[0].currentEpisode.status).toBe('ACTIVE');
        // The pending candidate keeps its reserved code: it joins later with that exact code.
        const offer = pending.body.offer;
        await status('hr', offer.id, 'ACCEPTED');
        expect((await join('hr', offer.id, daysAgo(0))).status).toBe(201);
        expect(
          await prisma.employeeProfile.count({
            where: { employeeCode: pending.body.person.employeeCode },
          }),
        ).toBe(1);
      });

      it('keeps the reserved 1-100 block owner-only: TOTP is still required and the register never allocates it', async () => {
        const reservedNumber = 90 + (parseInt(run, 16) % 9); // 90-98: unlikely to be taken by other fixtures
        await prisma.hrPerson
          .deleteMany({
            where: {
              employeeCode: `FQ-FE-${String(reservedNumber).padStart(5, '0')}`,
            },
          })
          .catch(() => undefined);
        const body = (code: string) => ({
          employeeNumber: reservedNumber,
          fullName: `Reserved ${run}`,
          territory: 'HQ',
          password: 'Reserved-Pass-1',
          confirmPassword: 'Reserved-Pass-1',
          totpCode: code,
        });
        const bad = await call(
          'post',
          'admin/employees/special',
          tok.platform,
          body('000000'),
        );
        expect(bad.status).toBeGreaterThanOrEqual(400);
        const hrOnly = await call(
          'post',
          'admin/employees/special',
          tok.hr,
          body('123456'),
        );
        expect(hrOnly.status).toBeGreaterThanOrEqual(400);
        const good = await call(
          'post',
          'admin/employees/special',
          tok.platform,
          body(await totp.generateToken(ids.platformSecret)),
        );
        if (good.status === 409) return; // already consumed by a previous run on this database: the guard is doing its job
        expect(good.status).toBe(201);
        expect(good.body.employeeCode).toBe(
          `FQ-FE-${String(reservedNumber).padStart(5, '0')}`,
        );
        const again = await call(
          'post',
          'admin/employees/special',
          tok.platform,
          body(await totp.generateToken(ids.platformSecret)),
        );
        expect(again.status).toBe(409);
        expect(
          await prisma.hrPerson.count({
            where: { codeNumber: { lt: 101 }, origin: 'OFFER' },
          }),
        ).toBe(0);
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('contacts, letters and PDF history', () => {
      it("keeps each letter's contact-at-issue snapshot when the current contact is edited, with an audited reason and no value in the log", async () => {
        const first = await newCandidate(`Contactchange${run} Tester`);
        const person = first.body.person;
        const v1 = first.body.offer;
        const before = await call(
          'get',
          `admin/hr/offers/${v1.id}/letter-data`,
          tok.hr,
        );
        expect(before.status).toBe(200);
        expect(before.body).toMatchObject({
          candidateName: first.contact.fullName,
          email: first.contact.email,
          phone: first.contact.phone,
        });
        const newPhone = phone();
        const updated = await call(
          'post',
          `admin/hr/persons/${person.id}/contact`,
          tok.hr,
          { phone: newPhone, reason: 'Candidate changed mobile number' },
        );
        expect(updated.status).toBe(201);
        expect(updated.body.maskedPhone).not.toBe(person.maskedPhone);
        const after = await call(
          'get',
          `admin/hr/offers/${v1.id}/letter-data`,
          tok.hr,
        );
        expect(after.body.phone).toBe(first.contact.phone); // the old letter is not rewritten
        const audit = await call(
          'get',
          `admin/hr/persons/${person.id}/audit?limit=100`,
          tok.hr,
        );
        expect(JSON.stringify(audit.body)).not.toContain(newPhone);
        expect(JSON.stringify(audit.body)).not.toContain(first.contact.phone);
        expect(audit.body.items.map((e: Json) => e.action)).toEqual(
          expect.arrayContaining(['CONTACT_UPDATED', 'LETTER_DATA_READ']),
        );
        // The new phone now matches, but only as a hint; identity is never changed by a contact alone.
        const hint = await match('hr', { phone: newPhone });
        expect(hint.matches.map((m: Json) => m.person.id)).toContain(person.id);
      });

      it('records PDF history with the content fingerprint, append-only', async () => {
        const first = await newCandidate(`Pdfhistory${run} Tester`);
        const offerId = first.body.offer.id;
        const sha = 'a'.repeat(63) + 'b';
        for (const event of ['GENERATED', 'REPRINTED']) {
          const res = await call(
            'post',
            `admin/hr/offers/${offerId}/pdf-events`,
            tok.hr,
            { event, sha256: sha, byteLength: 82719 },
          );
          expect(res.status).toBe(201);
        }
        expect(
          (
            await call(
              'post',
              `admin/hr/offers/${offerId}/pdf-events`,
              tok.hr,
              { event: 'GENERATED', sha256: 'XYZ', byteLength: 1 },
            )
          ).status,
        ).toBe(400);
        const detail = await getPerson('hr', first.body.person.id);
        expect(
          detail.offers[0].pdfHistory.map((p: Json) => [p.event, p.sha256]),
        ).toEqual([
          ['GENERATED', sha],
          ['REPRINTED', sha],
        ]);
        await expect(
          prisma.hrPdfEvent.updateMany({
            where: { offerId },
            data: { byteLength: 1 },
          }),
        ).rejects.toThrow(/append-only/i);
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('reconciliation of previously emailed letters (IDs stay UNVERIFIED)', () => {
      it('imports ten synthetic letters idempotently, derives no ID, hides raw addresses, and refuses a new ID where one was printed', async () => {
        const rows = Array.from({ length: 10 }, (_, i) => ({
          sentOn: `2026-10-${String(8 + i).padStart(2, '0')}`,
          recipientEmail: `recon-${run}-${i}@example.test`,
          candidateLabel: i === 4 ? undefined : `Recon Candidate ${i} ${run}`,
          printedEmployeeCode: i === 2 ? 'FQ-FE-99999' : undefined,
        }));
        const imported = await call(
          'post',
          'admin/hr/reconciliation/import',
          tok.hr,
          { items: rows },
        );
        expect(imported.status).toBe(201);
        expect(imported.body).toEqual({ received: 10, created: 10 });
        expect(
          (
            await call('post', 'admin/hr/reconciliation/import', tok.hr, {
              items: rows,
            })
          ).body.created,
        ).toBe(0);

        const listed = await call(
          'get',
          'admin/hr/reconciliation?status=UNVERIFIED&limit=100',
          tok.hr,
        );
        const mine = listed.body.items.filter(
          (item: Json) =>
            (item.candidateLabel ?? '').includes(run) ||
            item.maskedRecipient.includes('@example.test'),
        );
        expect(mine.length).toBeGreaterThanOrEqual(10);
        expect(JSON.stringify(listed.body)).not.toContain(`recon-${run}`);
        expect(JSON.stringify(listed.body)).not.toMatch(
          /FQ-FE-\d{5}.*"status":"LINKED"/,
        );
        const byLabel = (n: number) =>
          listed.body.items.find(
            (item: Json) =>
              item.candidateLabel === `Recon Candidate ${n} ${run}`,
          ) as Json;

        // Mark a forward as a duplicate: no person, no code.
        const duplicate = await call(
          'post',
          `admin/hr/reconciliation/${byLabel(6).id}/duplicate`,
          tok.hr,
          { duplicateOfItemId: byLabel(3).id },
        );
        expect(duplicate.body).toMatchObject({
          status: 'DUPLICATE',
          possibleDuplicateOf: byLabel(3).id,
        });
        expect(
          (
            await call(
              'post',
              `admin/hr/reconciliation/${byLabel(6).id}/duplicate`,
              tok.hr,
              { duplicateOfItemId: byLabel(3).id },
            )
          ).status,
        ).toBe(409);

        // A letter that printed an ID can only be linked to that exact person; a new ID is refused.
        const printed = byLabel(2);
        expect(printed.printedEmployeeCode).toBe('FQ-FE-99999');
        const refused = await call(
          'post',
          `admin/hr/reconciliation/${printed.id}/create-identity`,
          tok.hr,
          { historyChecked: true },
        );
        expect(refused.status).toBe(409);
        expect(refused.body.error.code).toBe('HR_PRINTED_CODE_MUST_BE_LINKED');
        const someone = (await newCandidate(`Retarget${run} Zubin`)).body
          .person;
        const mismatch = await call(
          'post',
          `admin/hr/reconciliation/${printed.id}/link`,
          tok.hr,
          { personId: someone.id },
        );
        expect(mismatch.status).toBe(409);
        expect(mismatch.body.error.code).toBe('HR_PRINTED_CODE_MISMATCH');

        // Link an unprinted letter to a verified person.
        const linked = await call(
          'post',
          `admin/hr/reconciliation/${byLabel(1).id}/link`,
          tok.hr,
          { personId: someone.id },
        );
        expect(linked.body).toMatchObject({
          status: 'LINKED',
          linkedPerson: { employeeCode: someone.employeeCode },
        });

        // Only with "history checked" and a recorded name does a letter become an identity (a read-only historical record).
        expect(
          (
            await call(
              'post',
              `admin/hr/reconciliation/${byLabel(7).id}/create-identity`,
              tok.hr,
              { historyChecked: false },
            )
          ).status,
        ).toBe(400);
        const created = await call(
          'post',
          `admin/hr/reconciliation/${byLabel(7).id}/create-identity`,
          tok.hr,
          { historyChecked: true },
        );
        expect(created.status).toBe(201);
        expect(created.body.status).toBe('IDENTITY_CREATED');
        const person = await getPerson('hr', created.body.linkedPerson.id);
        expect(person).toMatchObject({
          origin: 'RECONCILIATION',
          hasEmployeeAccount: false,
        });
        expect(person.offers[0]).toMatchObject({
          source: 'HISTORICAL_IMPORT',
          status: 'SENT',
          version: 1,
        });
        expect(
          (
            await call(
              'get',
              `admin/hr/offers/${person.offers[0].id}/letter-data`,
              tok.hr,
            )
          ).status,
        ).toBe(409); // no stored letter
        expect(
          (
            await call(
              'post',
              `admin/hr/offers/${person.offers[0].id}/pdf-events`,
              tok.hr,
              { event: 'GENERATED', sha256: 'c'.repeat(64), byteLength: 5 },
            )
          ).status,
        ).toBe(409);
        // No letter without a name can become a person.
        const nameless = listed.body.items.find(
          (item: Json) =>
            item.candidateLabel === null &&
            item.maskedRecipient.includes('@example.test') &&
            item.status === 'UNVERIFIED' &&
            item.printedEmployeeCode === null,
        );
        if (nameless)
          expect(
            (
              await call(
                'post',
                `admin/hr/reconciliation/${nameless.id}/create-identity`,
                tok.hr,
                { historyChecked: true },
              )
            ).status,
          ).toBe(422);
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('search, paging and the audit trail', () => {
      it('searches by code, name, e-mail and phone with bounded pages and a stable cursor', async () => {
        const a = await newCandidate(`Alpha${run} Searchable`, {
          contactLabel: 'sa',
        });
        await newCandidate(`Beta${run} Searchable`, { contactLabel: 'sb' });
        const byCode = await call(
          'get',
          `admin/hr/register?employeeCode=${a.body.person.employeeCode}`,
          tok.hr,
        );
        expect(byCode.body.total).toBe(1);
        const byName = await call(
          'get',
          `admin/hr/register?q=${encodeURIComponent(`alpha${run} searchable`)}`,
          tok.hr,
        );
        expect(byName.body.items.map((p: Json) => p.id)).toEqual([
          a.body.person.id,
        ]);
        const byEmail = await call(
          'get',
          `admin/hr/register?q=${encodeURIComponent(a.contact.email)}`,
          tok.hr,
        );
        expect(byEmail.body.items.map((p: Json) => p.id)).toEqual([
          a.body.person.id,
        ]);
        const byPhone = await call(
          'get',
          `admin/hr/register?q=${encodeURIComponent(a.contact.phone)}`,
          tok.hr,
        );
        expect(byPhone.body.items.map((p: Json) => p.id)).toEqual([
          a.body.person.id,
        ]);
        expect(byPhone.body.items[0].offerCount).toBe(1);

        const page1 = await call(
          'get',
          `admin/hr/register?q=${encodeURIComponent(`searchable`)}&limit=1`,
          tok.hr,
        );
        expect(page1.body.items).toHaveLength(1);
        expect(page1.body.nextCursor).toBeTruthy();
        const page2 = await call(
          'get',
          `admin/hr/register?q=${encodeURIComponent(`searchable`)}&limit=1&cursor=${page1.body.nextCursor}`,
          tok.hr,
        );
        expect(
          page2.body.items[0].employeeCode > page1.body.items[0].employeeCode,
        ).toBe(true);
        expect(
          (await call('get', 'admin/hr/register?limit=1000', tok.hr)).status,
        ).toBe(400);
        expect(
          (await call('get', 'admin/hr/register?employeeCode=nope', tok.hr))
            .status,
        ).toBe(400);

        const offered = await call(
          'get',
          'admin/hr/register?lifecycle=OFFERED&limit=100',
          tok.hr,
        );
        expect(
          offered.body.items.every(
            (p: Json) =>
              p.currentEpisode.status === 'PENDING_JOIN' &&
              p.currentEpisode.episodeNumber === 1,
          ),
        ).toBe(true);
      });

      it('returns the audit trail newest first with a working cursor and no contact values', async () => {
        const first = await newCandidate(`Audittrail${run} Tester`);
        const offerId = first.body.offer.id;
        await status('hr', offerId, 'SENT');
        await status('hr', offerId, 'ACCEPTED');
        const page1 = await call(
          'get',
          `admin/hr/persons/${first.body.person.id}/audit?limit=2`,
          tok.hr,
        );
        expect(page1.body.items.map((e: Json) => e.action)).toEqual([
          'OFFER_ACCEPTED',
          'OFFER_SENT',
        ]);
        expect(page1.body.items[0]).toMatchObject({
          fromStatus: 'SENT',
          toStatus: 'ACCEPTED',
        });
        const page2 = await call(
          'get',
          `admin/hr/persons/${first.body.person.id}/audit?limit=2&cursor=${page1.body.nextCursor}`,
          tok.hr,
        );
        expect(page2.body.items.map((e: Json) => e.action)).toEqual([
          'OFFER_ISSUED',
          'IDENTITY_CREATED',
        ]);
        expect(page2.body.nextCursor).toBeNull();
        expect(JSON.stringify([page1.body, page2.body])).not.toContain(
          first.contact.email,
        );
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    describe('database-level guarantees (hold even if application code were bypassed)', () => {
      const sql = (text: string) => prisma.$executeRawUnsafe(text);

      it('never lets a code be changed, a person or history row be deleted, or issued terms be edited', async () => {
        const first = await newCandidate(`Dbguards${run} Tester`);
        const person = first.body.person.id;
        const offer = first.body.offer.id;
        await expect(
          sql(
            `UPDATE hr_persons SET "employeeCode" = 'FQ-FE-77777', "codeNumber" = 77777 WHERE id = '${person}'`,
          ),
        ).rejects.toThrow(/immutable/i);
        await expect(
          sql(`DELETE FROM hr_persons WHERE id = '${person}'`),
        ).rejects.toThrow(/undeletable|never be deleted/i);
        await expect(
          sql(`DELETE FROM hr_offer_versions WHERE id = '${offer}'`),
        ).rejects.toThrow(/never be deleted/i);
        await expect(
          sql(
            `UPDATE hr_offer_versions SET "baseSalaryInr" = 1 WHERE id = '${offer}'`,
          ),
        ).rejects.toThrow(/immutable/i);
        await expect(
          sql(
            `UPDATE hr_offer_versions SET "expectedPerformanceIncentiveMonthlyInr" = 0 WHERE id = '${offer}'`,
          ),
        ).rejects.toThrow(/immutable/i);
        await expect(
          sql(
            `UPDATE hr_offer_versions SET status = 'DRAFT' WHERE id = '${offer}'`,
          ),
        ).rejects.toThrow(/invalid_transition|not allowed/i);
        await expect(
          sql(
            `UPDATE hr_audit_events SET action = 'X' WHERE "personId" = '${person}'`,
          ),
        ).rejects.toThrow(/append-only/i);
        await expect(
          sql(`DELETE FROM hr_audit_events WHERE "personId" = '${person}'`),
        ).rejects.toThrow(/never be deleted/i);
        await expect(
          sql(
            `INSERT INTO hr_employment_episodes (id, "personId", "episodeNumber", status, "updatedAt") VALUES (gen_random_uuid()::text, '${person}', 2, 'PENDING_JOIN', now())`,
          ),
        ).rejects.toThrow(/already_open|already has an open/i);
        await expect(
          sql(`INSERT INTO hr_offer_versions (id, "personId", "episodeId", version, kind, role, "baseSalaryInr", "salaryBasis", "updatedAt")
             SELECT gen_random_uuid()::text, '${person}', "episodeId", 7, 'REOFFER', 'x', 1, 'MONTHLY', now() FROM hr_offer_versions WHERE id = '${offer}'`),
        ).rejects.toThrow(/version_gap|next offer version/i);
      });

      it('keeps the employee profile table consistent with the register', async () => {
        const first = await newCandidate(`Profileguard${run} Tester`);
        const code = first.body.person.employeeCode;
        const user = await prisma.user.create({
          data: { email: email('guard'), status: 'ACTIVE' },
        });
        // An old, un-drained backend instance (or any raw insert) cannot take a code that belongs to a register person.
        await expect(
          prisma.employeeProfile.create({
            data: { userId: user.id, employeeCode: code, fullName: 'Thief' },
          }),
        ).rejects.toThrow(/reserved|belongs to a register person/i);
        expect(
          await prisma.employeeProfile.count({ where: { employeeCode: code } }),
        ).toBe(0);
        // ...and a code on an existing profile can never be edited.
        const legacyUser = await prisma.user.create({
          data: { email: email('guard2'), status: 'ACTIVE' },
        });
        const legacyCode = `FQ-FE-${String(60000 + (parseInt(run, 16) % 9000)).padStart(5, '0')}`;
        const legacy = await prisma.employeeProfile.create({
          data: {
            userId: legacyUser.id,
            employeeCode: legacyCode,
            fullName: `Legacy Guard ${run}`,
          },
        });
        await expect(
          prisma.employeeProfile.update({
            where: { id: legacy.id },
            data: { employeeCode: 'FQ-FE-00001' },
          }),
        ).rejects.toThrow(/immutable/i);
      });

      it('holds the global invariants: every profile has exactly one register person with the identical code, and codes are unique', async () => {
        const rows = await prisma.$queryRawUnsafe<Array<{ bad: number }>>(
          `SELECT count(*)::int AS bad FROM employee_profiles ep LEFT JOIN hr_persons p ON p."employeeProfileId" = ep.id AND p."employeeCode" = ep."employeeCode" WHERE p.id IS NULL`,
        );
        expect(rows[0].bad).toBe(0);
        const dup = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
          `SELECT count(*)::int AS n FROM (SELECT "employeeCode" FROM hr_persons GROUP BY 1 HAVING count(*) > 1) d`,
        );
        expect(dup[0].n).toBe(0);
        const standardBelow = await prisma.$queryRawUnsafe<
          Array<{ n: number }>
        >(
          `SELECT count(*)::int AS n FROM hr_persons WHERE origin IN ('OFFER','RECONCILIATION') AND "codeNumber" < 101`,
        );
        expect(standardBelow[0].n).toBe(0);
      });
    });
  },
);
