import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * Owner issue #28: an employee suggests a correction, only the shop's owner can apply it.
 * Real AppModule, real guards, real PostgreSQL. Refuses anything but a loopback database and only touches
 * fixtures carrying this run's tag.
 */
const databaseUrl = process.env.DATABASE_URL ?? '';
const isLoopbackDatabase = /@(127\.0\.0\.1|localhost)[:/]/i.test(databaseUrl);
const describeDisposable = isLoopbackDatabase ? describe : describe.skip;

describeDisposable(
  'Salon change requests (employee suggests, owner approves; disposable PostgreSQL)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokens: TokenService;
    const run = randomUUID().slice(0, 8);
    const ids: Record<string, string> = {};
    const auth: Record<string, string> = {};

    const api = (
      method: 'get' | 'post',
      path: string,
      token?: string,
      body?: object,
    ) => {
      const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
      if (token) req.set('Authorization', `Bearer ${token}`);
      if (method === 'post') req.set('Idempotency-Key', randomUUID());
      return body ? req.send(body) : req;
    };

    async function makeUser(
      label: string,
      role: Role | null,
      audience: SessionAudience,
      salonId: string | null = null,
    ) {
      const user = await prisma.user.create({
        data: {
          email: `chg-${run}-${label}@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      if (role) {
        await prisma.userRole.create({
          data: { userId: user.id, role, salonId },
        });
      }
      ids[label] = user.id;
      auth[label] = tokens.signAccessToken(
        user.id,
        role ? [role] : [],
        audience,
      );
      return user;
    }

    async function makeShop(label: string, address: string) {
      const city = await prisma.city.findFirstOrThrow({
        where: { slug: 'jharsuguda' },
      });
      const owner = await makeUser(`${label}Owner`, null, SessionAudience.STAFF);
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name: `Change ${label} ${run}`,
          slug: `change-${label.toLowerCase()}-${run}`,
          cityId: city.id,
          addressLine: address,
          localityText: 'Old Locality',
          status: SalonStatus.ACTIVE,
          timezone: 'Asia/Kolkata',
          currency: 'INR',
        },
      });
      await prisma.userRole.create({
        data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id },
      });
      // The token must carry the owner role, which exists only now that the salon does.
      auth[`${label}Owner`] = tokens.signAccessToken(
        owner.id,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
      ids[`${label}Salon`] = salon.id;
      return salon;
    }

    async function makeEmployee(label: string, salonId: string) {
      const user = await makeUser(
        label,
        Role.FIELD_EXECUTIVE,
        SessionAudience.EMPLOYEE,
      );
      const profile = await prisma.employeeProfile.create({
        data: {
          userId: user.id,
          employeeCode: `EMP${run}${label}`.toUpperCase(),
          fullName: `Synthetic ${label} ${run}`,
        },
      });
      const lead = await prisma.employeeCrmLead.create({
        data: {
          employeeProfileId: profile.id,
          shopName: `Lead ${label} ${run}`,
          onboardedSalonId: salonId,
          onboardedAt: new Date(),
        },
      });
      ids[`${label}Lead`] = lead.id;
    }

    const empPath = (label: string, suffix = '') =>
      `employee/leads/${ids[`${label}Lead`]}/shop/change-requests${suffix}`;
    const ownerPath = (shop: string, suffix = '') =>
      `dashboard/salons/${ids[`${shop}Salon`]}/change-requests${suffix}`;
    const salonRow = (shop: string) =>
      prisma.salon.findUniqueOrThrow({ where: { id: ids[`${shop}Salon`] } });

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

      await makeShop('A', '1 Original Road');
      await makeShop('B', '2 Other Road');
      await makeEmployee('empA', ids.ASalon);
      await makeEmployee('empB', ids.BSalon);
      await makeUser('customer', null, SessionAudience.CUSTOMER);
    });

    afterAll(async () => {
      await app?.close();
    });

    it('lets the employee suggest a correction without changing the shop', async () => {
      const res = await api('post', empPath('empA'), auth.empA, {
        field: 'ADDRESS_LINE',
        value: '  1 Corrected Road  ',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        field: 'ADDRESS_LINE',
        proposedValue: '1 Corrected Road',
        previousValue: '1 Original Road',
        status: 'PENDING',
      });
      expect((await salonRow('A')).addressLine).toBe('1 Original Road');
    });

    it('allows only one waiting request per shop and field, and rejects no-op or invalid text', async () => {
      const dup = await api('post', empPath('empA'), auth.empA, {
        field: 'ADDRESS_LINE',
        value: '1 Another Road',
      });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('CHANGE_REQUEST_PENDING');

      const same = await api('post', empPath('empA'), auth.empA, {
        field: 'LOCALITY_TEXT',
        value: 'Old Locality',
      });
      expect(same.status).toBe(422);
      expect(same.body.error.code).toBe('CHANGE_REQUEST_NO_CHANGE');

      for (const value of ['', '   ', 'x'.repeat(201)]) {
        const bad = await api('post', empPath('empA'), auth.empA, {
          field: 'LOCALITY_TEXT',
          value,
        });
        expect(bad.status).toBe(400);
      }
      const badField = await api('post', empPath('empA'), auth.empA, {
        field: 'PHONE',
        value: '9999999999',
      });
      expect(badField.status).toBe(400);
    });

    it('isolates employees: another employee, a customer, or no token cannot use this lead', async () => {
      expect(
        (await api('get', empPath('empA'), auth.empB)).status,
      ).toBe(404);
      expect(
        (
          await api('post', empPath('empA'), auth.empB, {
            field: 'LOCALITY_TEXT',
            value: 'Hijack',
          })
        ).status,
      ).toBe(404);
      expect((await api('get', empPath('empA'), auth.customer)).status).toBe(
        403,
      );
      expect((await api('get', empPath('empA'))).status).toBe(401);
      expect((await salonRow('A')).localityText).toBe('Old Locality');
    });

    it('isolates owners: another shop owner, the employee and a customer cannot list or decide', async () => {
      const pending = await prisma.salonChangeRequest.findFirstOrThrow({
        where: { salonId: ids.ASalon, status: 'PENDING' },
      });
      for (const who of ['BOwner', 'empA', 'customer']) {
        expect((await api('get', ownerPath('A'), auth[who])).status).toBe(403);
        const decide = await api(
          'post',
          ownerPath('A', `/${pending.id}/decision`),
          auth[who],
          { decision: 'APPROVE' },
        );
        expect(decide.status).toBe(403);
      }
      // The other owner cannot decide through THEIR OWN shop path either: the request is not theirs.
      const cross = await api(
        'post',
        ownerPath('B', `/${pending.id}/decision`),
        auth.BOwner,
        { decision: 'APPROVE' },
      );
      expect(cross.status).toBe(404);
      expect((await salonRow('A')).addressLine).toBe('1 Original Road');
      expect(
        (await prisma.salonChangeRequest.findUniqueOrThrow({ where: { id: pending.id } }))
          .status,
      ).toBe('PENDING');
    });

    it('shows the owner the waiting request with the employee name, and applies it only on approval', async () => {
      const list = await api('get', ownerPath('A'), auth.AOwner);
      expect(list.status).toBe(200);
      expect(list.body[0]).toMatchObject({
        status: 'PENDING',
        proposedValue: '1 Corrected Road',
        requestedByName: `Synthetic empA ${run}`,
      });
      const decided = await api(
        'post',
        ownerPath('A', `/${list.body[0].id}/decision`),
        auth.AOwner,
        { decision: 'APPROVE', note: 'Checked' },
      );
      expect(decided.status).toBe(201);
      expect(decided.body).toMatchObject({ status: 'APPROVED', decisionNote: 'Checked' });
      expect((await salonRow('A')).addressLine).toBe('1 Corrected Road');
      const audit = await prisma.auditLog.findFirst({
        where: { entityId: list.body[0].id, action: 'SALON_CHANGE_REQUEST_APPROVED' },
      });
      expect(audit?.actorUserId).toBe(ids.AOwner);

      const again = await api(
        'post',
        ownerPath('A', `/${list.body[0].id}/decision`),
        auth.AOwner,
        { decision: 'REJECT' },
      );
      expect(again.status).toBe(404);
      expect((await salonRow('A')).addressLine).toBe('1 Corrected Road');
    });

    it('a rejection changes nothing and frees the slot for a new suggestion', async () => {
      const made = await api('post', empPath('empA'), auth.empA, {
        field: 'LOCALITY_TEXT',
        value: 'New Locality',
      });
      expect(made.status).toBe(201);
      const rejected = await api(
        'post',
        ownerPath('A', `/${made.body.id}/decision`),
        auth.AOwner,
        { decision: 'REJECT', note: 'Not correct' },
      );
      expect(rejected.body.status).toBe('REJECTED');
      expect((await salonRow('A')).localityText).toBe('Old Locality');
      const next = await api('post', empPath('empA'), auth.empA, {
        field: 'LOCALITY_TEXT',
        value: 'Better Locality',
      });
      expect(next.status).toBe(201);
    });

    it('lets the employee withdraw only their own waiting request', async () => {
      const waiting = await prisma.salonChangeRequest.findFirstOrThrow({
        where: { salonId: ids.ASalon, status: 'PENDING' },
      });
      expect(
        (await api('post', empPath('empA', `/${waiting.id}/withdraw`), auth.empB))
          .status,
      ).toBe(404);
      const ok = await api(
        'post',
        empPath('empA', `/${waiting.id}/withdraw`),
        auth.empA,
      );
      expect(ok.status).toBe(201);
      expect(ok.body.status).toBe('WITHDRAWN');
      const owner = await api(
        'post',
        ownerPath('A', `/${waiting.id}/decision`),
        auth.AOwner,
        { decision: 'APPROVE' },
      );
      expect(owner.status).toBe(404);
      expect((await salonRow('A')).localityText).toBe('Old Locality');
    });

    it('the database itself refuses a waiting row without its slot or an approved row without a decider', async () => {
      const base = {
        id: randomUUID(),
        salonId: ids.ASalon,
        field: 'LOCALITY_TEXT',
        proposedValue: 'x',
        requestedByUserId: ids.empA,
      };
      await expect(
        prisma.salonChangeRequest.create({
          data: { ...base, status: 'PENDING', pendingSlot: null } as never,
        }),
      ).rejects.toThrow();
      await expect(
        prisma.salonChangeRequest.create({
          data: { ...base, id: randomUUID(), status: 'APPROVED', pendingSlot: null, decidedAt: new Date() } as never,
        }),
      ).rejects.toThrow();
    });
  },
);
