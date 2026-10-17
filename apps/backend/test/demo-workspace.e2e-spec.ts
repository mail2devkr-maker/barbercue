import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  BookingSource,
  BookingStatus,
  QueueEntrySource,
  QueueEntryStatus,
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

// This mutating test suite only runs in GitHub's isolated PostgreSQL service, or after an explicit
// local opt-in AND an allow-listed disposable database name. A loopback host alone is not enough.
const connection = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '');
  } catch {
    return null;
  }
})();
const isLoopback =
  connection?.hostname === '127.0.0.1' || connection?.hostname === 'localhost';
const isNamedDisposable = /^\/(owner_ops_chain|demo_workspace_e2e)$/.test(
  connection?.pathname ?? '',
);
const approvedRunner =
  (process.env.GITHUB_ACTIONS === 'true' &&
    process.env.OWNER_DEMO_WORKSPACE_ENABLED === 'true') ||
  process.env.ALLOW_DEMO_WORKSPACE_E2E === 'yes';
const runAgainstDisposableDb = Boolean(
  isLoopback && isNamedDisposable && approvedRunner,
);
const maybe = runAgainstDisposableDb ? describe : describe.skip;

maybe(
  'Owner demo workspace (authenticated PostgreSQL e2e, disposable database only)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokens: TokenService;
    const run = randomUUID().replace(/-/g, '').slice(0, 10);
    const ids: Record<string, string> = {};
    const token: Record<string, string> = {};

    const api = (
      method: 'get' | 'post' | 'delete',
      path: string,
      auth?: string,
      idempotencyKey?: string,
    ) => {
      const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
      if (auth) req.set('Authorization', `Bearer ${auth}`);
      if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
      return req;
    };

    async function makeUser(
      label: string,
      roles: Array<{ role: Role; salonId: string | null }>,
    ) {
      const user = await prisma.user.create({
        data: {
          email: `demo-workspace-${run}-${label}@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      for (const membership of roles) {
        await prisma.userRole.create({
          data: { userId: user.id, ...membership },
        });
      }
      ids[label] = user.id;
      const audience = roles.some(
        (entry) =>
          entry.role === Role.SALON_OWNER || entry.role === Role.SALON_STAFF,
      )
        ? SessionAudience.STAFF
        : SessionAudience.CUSTOMER;
      token[label] = tokens.signAccessToken(
        user.id,
        roles.map((entry) => entry.role),
        audience,
      );
      return user;
    }

    async function realShopFingerprint(salonId: string) {
      const [
        salon,
        services,
        staff,
        chairs,
        bookings,
        bookingServices,
        queue,
        invoices,
        invoicePayments,
        ledger,
        notifications,
      ] = await Promise.all([
        prisma.salon.findUnique({
          where: { id: salonId },
          select: {
            id: true,
            ownerUserId: true,
            name: true,
            status: true,
            queueAutoAssignEnabled: true,
          },
        }),
        prisma.service.findMany({
          where: { salonId },
          orderBy: { id: 'asc' },
          select: { id: true, name: true, price: true, isActive: true },
        }),
        prisma.salonStaff.findMany({
          where: { salonId },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            userId: true,
            displayName: true,
            roleInSalon: true,
            status: true,
          },
        }),
        prisma.chair.findMany({
          where: { salonId },
          orderBy: { id: 'asc' },
          select: { id: true, label: true, status: true },
        }),
        prisma.booking.findMany({
          where: { salonId },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            customerId: true,
            serviceId: true,
            slotStart: true,
            slotEnd: true,
            status: true,
            source: true,
          },
        }),
        prisma.bookingService.findMany({
          where: { booking: { salonId } },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            bookingId: true,
            serviceId: true,
            serviceName: true,
            price: true,
          },
        }),
        prisma.queueEntry.findMany({
          where: { salonId },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            serviceId: true,
            source: true,
            status: true,
            tokenNumber: true,
            joinedAt: true,
          },
        }),
        prisma.invoice.findMany({
          where: { salonId },
          orderBy: { id: 'asc' },
          select: { id: true, number: true, total: true, status: true },
        }),
        prisma.invoicePayment.findMany({
          where: { salonId },
          orderBy: { id: 'asc' },
          select: { id: true, invoiceId: true, kind: true, amount: true },
        }),
        prisma.customerLedgerEntry.findMany({
          where: { salonId },
          orderBy: { id: 'asc' },
          select: { id: true, bookingId: true, amount: true, status: true },
        }),
        prisma.notificationDelivery.findMany({
          where: { deepLink: { contains: salonId } },
          orderBy: { id: 'asc' },
          select: { id: true, status: true, type: true },
        }),
      ]);
      return JSON.stringify({
        salon,
        services,
        staff,
        chairs,
        bookings,
        bookingServices,
        queue,
        invoices,
        invoicePayments,
        ledger,
        notifications,
      });
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

      const city = await prisma.city.findFirstOrThrow({
        where: { slug: 'jharsuguda' },
      });
      const ownerA = await makeUser('owner-a', []);
      const salonA = await prisma.salon.create({
        data: {
          ownerUserId: ownerA.id,
          name: `Demo isolation real shop ${run}`,
          slug: `demo-iso-${run}-a`,
          cityId: city.id,
          addressLine: '1 Disposable Test Road',
          status: SalonStatus.ACTIVE,
          timezone: 'Asia/Kolkata',
          currency: 'INR',
        },
      });
      ids.salonA = salonA.id;
      await prisma.userRole.create({
        data: { userId: ownerA.id, role: Role.SALON_OWNER, salonId: salonA.id },
      });
      token['owner-a'] = tokens.signAccessToken(
        ownerA.id,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );

      const ownerB = await makeUser('owner-b', []);
      const salonB = await prisma.salon.create({
        data: {
          ownerUserId: ownerB.id,
          name: `Demo isolation other shop ${run}`,
          slug: `demo-iso-${run}-b`,
          cityId: city.id,
          addressLine: '2 Disposable Test Road',
          status: SalonStatus.ACTIVE,
          timezone: 'Asia/Kolkata',
          currency: 'INR',
        },
      });
      ids.salonB = salonB.id;
      await prisma.userRole.create({
        data: { userId: ownerB.id, role: Role.SALON_OWNER, salonId: salonB.id },
      });
      token['owner-b'] = tokens.signAccessToken(
        ownerB.id,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );

      const customer = await makeUser('customer', [
        { role: Role.CUSTOMER, salonId: null },
      ]);
      const staff = await makeUser('staff', [
        { role: Role.SALON_STAFF, salonId: salonA.id },
      ]);
      void customer;
      void staff;

      const service = await prisma.service.create({
        data: {
          salonId: salonA.id,
          name: `Existing real service ${run}`,
          durationMinutes: 30,
          price: '25.00',
        },
      });
      const bookingCustomer = await prisma.user.create({
        data: {
          email: `demo-workspace-${run}-booking@example.test`,
          status: UserStatus.ACTIVE,
        },
      });
      await prisma.userRole.create({
        data: {
          userId: bookingCustomer.id,
          role: Role.CUSTOMER,
          salonId: null,
        },
      });
      await prisma.booking.create({
        data: {
          salonId: salonA.id,
          customerId: bookingCustomer.id,
          serviceId: service.id,
          slotStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
          slotEnd: new Date(Date.now() + 48 * 60 * 60 * 1000 + 30 * 60 * 1000),
          status: BookingStatus.CONFIRMED,
          source: BookingSource.APP,
          idempotencyKey: randomUUID(),
          services: {
            create: [
              {
                serviceId: service.id,
                sortOrder: 0,
                serviceName: service.name,
                durationMinutes: 30,
                price: '25.00',
              },
            ],
          },
        },
      });
      await prisma.queueEntry.create({
        data: {
          salonId: salonA.id,
          serviceId: service.id,
          source: QueueEntrySource.WALK_IN,
          tokenNumber: 1,
          status: QueueEntryStatus.WAITING,
          joinedAt: new Date(),
        },
      });
    }, 120_000);

    afterAll(async () => {
      await app?.close();
    });

    it('isolates synthetic data, enforces roles, serializes imports, and deletes only the active private payload', async () => {
      const realBefore = await realShopFingerprint(ids.salonA);
      const salonCountBefore = await prisma.salon.count();
      const userCountBefore = await prisma.user.count();
      const statusPath = `dashboard/salons/${ids.salonA}/demo/status`;
      const demoBasePath = `dashboard/salons/${ids.salonA}/demo`;
      const importPath = `${demoBasePath}/import`;
      const previewPath = `${demoBasePath}/delete-preview`;
      const deletePath = demoBasePath;
      const capabilitiesPath = `dashboard/salons/${ids.salonA}/capabilities`;

      await api('get', statusPath).expect(401);
      await api('get', statusPath, token.customer).expect(403);
      await api('get', statusPath, token.staff).expect(403);
      await api('get', statusPath, token['owner-b']).expect(403);
      await api('get', capabilitiesPath, token.customer).expect(403);
      await api('get', capabilitiesPath, token['owner-b']).expect(403);
      await api('get', capabilitiesPath, token['owner-a'])
        .expect(200)
        .expect(({ body }) => {
          expect(body.features.demoData.status).toBe('SANDBOX');
          expect(body.features.inventory.status).toBe('UNCONFIGURED');
        });
      await api('post', importPath, token['owner-b'], randomUUID())
        .send({})
        .expect(403);
      await api('post', previewPath, token['owner-b']).send({}).expect(403);
      await api('get', statusPath, token['owner-a'])
        .expect(200)
        .expect(({ body }) => expect(body.active).toBe(false));
      await api('post', importPath, token['owner-a']).send({}).expect(400);

      const firstImportKey = randomUUID();
      const imports = await Promise.all(
        Array.from({ length: 6 }, () =>
          api('post', importPath, token['owner-a'], firstImportKey).send({}),
        ),
      );
      for (const response of imports) expect(response.status).toBe(201);
      const workspaceIds = new Set(
        imports.map((response) => response.body.workspaceId),
      );
      expect(workspaceIds.size).toBe(1);
      const workspaceId = imports[0].body.workspaceId as string;
      const payload = (
        await api(
          'get',
          `${demoBasePath}/workspaces/${workspaceId}`,
          token['owner-a'],
        ).expect(200)
      ).body as {
        label: string;
        demoShop: { id: string; synthetic: boolean };
        counts: Record<string, number>;
        invoices: Array<{ isRecordedPayment: boolean }>;
        dataset: {
          demoShop: { id: string; synthetic: boolean };
          counts: Record<string, number>;
          invoices: Array<{ isRecordedPayment: boolean }>;
        };
      };
      expect(payload.label).toBe('DEMO DATA — Not real business records');
      expect(payload.dataset.demoShop.synthetic).toBe(true);
      expect(payload.dataset.demoShop.id).not.toBe(ids.salonA);
      expect(payload.dataset.counts.visits).toBe(36);
      expect(payload.dataset.counts.bookings).toBe(15);
      expect(
        payload.dataset.invoices.every((invoice) => !invoice.isRecordedPayment),
      ).toBe(true);
      await api(
        'get',
        `${demoBasePath}/workspaces/${workspaceId}`,
        token['owner-b'],
      ).expect(403);
      expect(
        await prisma.ownerDemoWorkspace.count({
          where: { salonId: ids.salonA },
        }),
      ).toBe(1);
      expect(
        await prisma.ownerDemoWorkspaceAudit.count({
          where: { salonId: ids.salonA },
        }),
      ).toBe(1);
      const reusedImportKey = randomUUID();
      const reusedImport = await api(
        'post',
        importPath,
        token['owner-a'],
        reusedImportKey,
      )
        .send({})
        .expect(201);
      expect(reusedImport.body.workspaceId).toBe(workspaceId);
      expect(
        await prisma.ownerDemoWorkspaceAudit.count({
          where: { salonId: ids.salonA },
        }),
      ).toBe(2);
      expect(await prisma.salon.count()).toBe(salonCountBefore);
      expect(await prisma.user.count()).toBe(userCountBefore);
      expect(
        await prisma.salon.count({ where: { name: 'FastQue Sample Studio' } }),
      ).toBe(0);
      expect(await realShopFingerprint(ids.salonA)).toBe(realBefore);

      await api('get', statusPath, token['owner-a'])
        .expect(200)
        .expect(({ body }) => {
          expect(body.active).toBe(true);
          expect(body.workspaceId).toBe(workspaceId);
          expect(body.counts.visits).toBe(36);
        });
      await api('delete', deletePath, token['owner-a']).send({}).expect(400);
      const preview = await api('post', previewPath, token['owner-a'])
        .send({})
        .expect(201);
      expect(typeof preview.body.confirmationToken).toBe('string');
      expect(new Date(preview.body.expiresAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
      await api('delete', deletePath, token['owner-a'])
        .send({
          workspaceId,
          confirmation: 'WRONG',
          confirmationToken: preview.body.confirmationToken,
        })
        .expect(400);
      await api('delete', deletePath, token['owner-a'])
        .send({
          workspaceId,
          confirmation: 'DELETE DEMO DATA',
          confirmationToken: `${preview.body.confirmationToken}x`,
        })
        .expect(400);
      expect(
        await prisma.ownerDemoWorkspace.count({
          where: { salonId: ids.salonA },
        }),
      ).toBe(1);

      const deletes = await Promise.all(
        Array.from({ length: 2 }, () =>
          api('delete', deletePath, token['owner-a']).send({
            workspaceId,
            confirmation: 'DELETE DEMO DATA',
            confirmationToken: preview.body.confirmationToken,
          }),
        ),
      );
      expect(deletes.every((response) => response.status === 200)).toBe(true);
      expect(deletes.filter((response) => response.body.deleted).length).toBe(
        1,
      );
      expect(
        deletes.find((response) => response.body.deleted)?.body,
      ).toMatchObject({ deleted: true, deletedWorkspaceId: workspaceId });
      await api('get', statusPath, token['owner-a'])
        .expect(200)
        .expect(({ body }) => expect(body.active).toBe(false));
      await api('delete', deletePath, token['owner-a'])
        .send({
          workspaceId,
          confirmation: 'DELETE DEMO DATA',
          confirmationToken: preview.body.confirmationToken,
        })
        .expect(200)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            deleted: false,
            deletedWorkspaceId: null,
          });
        });
      expect(
        await prisma.ownerDemoWorkspace.count({
          where: { salonId: ids.salonA },
        }),
      ).toBe(0);
      expect(await realShopFingerprint(ids.salonA)).toBe(realBefore);
      await api('post', importPath, token['owner-a'], firstImportKey)
        .send({})
        .expect(409);
      await api('post', importPath, token['owner-a'], reusedImportKey)
        .send({})
        .expect(409);

      const reimportKey = randomUUID();
      const reimported = await api(
        'post',
        importPath,
        token['owner-a'],
        reimportKey,
      )
        .send({})
        .expect(201);
      expect(reimported.body.workspaceId).not.toBe(workspaceId);
      const secondPreview = await api('post', previewPath, token['owner-a'])
        .send({})
        .expect(201);
      await api('delete', deletePath, token['owner-a'])
        .send({
          workspaceId: reimported.body.workspaceId,
          confirmation: 'DELETE DEMO DATA',
          confirmationToken: secondPreview.body.confirmationToken,
        })
        .expect(200);
      expect(
        await prisma.ownerDemoWorkspaceAudit.count({
          where: { salonId: ids.salonA },
        }),
      ).toBe(5);

      const audit = await prisma.ownerDemoWorkspaceAudit.findFirstOrThrow({
        where: { salonId: ids.salonA },
      });
      await expect(
        prisma.$executeRaw`UPDATE "owner_demo_workspace_audit" SET "action" = 'DELETED' WHERE "id" = ${audit.id}`,
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.$executeRaw`DELETE FROM "owner_demo_workspace_audit" WHERE "id" = ${audit.id}`,
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.$executeRaw`TRUNCATE TABLE "owner_demo_workspace_audit"`,
      ).rejects.toThrow(/append-only/);
      expect(await realShopFingerprint(ids.salonA)).toBe(realBefore);
    }, 120_000);
  },
);
