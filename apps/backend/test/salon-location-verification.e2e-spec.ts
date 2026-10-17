import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ADMIN_PATHS,
  DASHBOARD_PATHS,
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
 * This suite mutates only uniquely named fixtures in a disposable loopback PostgreSQL database.
 * It exercises the real HTTP routes, JWT/RBAC guards, Prisma transactions, and database checks.
 */
const databaseUrl = process.env.DATABASE_URL ?? '';
const isLoopbackDatabase = /@(127\.0\.0\.1|localhost)[:/]/i.test(databaseUrl);
const describeDisposable = isLoopbackDatabase ? describe : describe.skip;

describeDisposable(
  'Salon location verification (real disposable PostgreSQL HTTP E2E)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokens: TokenService;
    const run = randomUUID();
    const ids: Record<string, string> = {};
    const auth: Record<string, string> = {};

    const api = (
      method: 'get' | 'post' | 'patch',
      path: string,
      token?: string,
    ) => {
      const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
      if (token) req.set('Authorization', `Bearer ${token}`);
      return req;
    };

    async function createUser(
      label: string,
      roles: Array<{ role: Role; salonId: string | null }>,
    ) {
      const user = await prisma.user.create({
        data: {
          email: `location-${run}-${label}@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      for (const role of roles) {
        await prisma.userRole.create({
          data: { userId: user.id, role: role.role, salonId: role.salonId },
        });
      }
      ids[label] = user.id;
      auth[label] = tokens.signAccessToken(
        user.id,
        roles.map(({ role }) => role),
        roles.some(({ role }) => role === Role.PLATFORM_ADMIN)
          ? SessionAudience.ADMIN
          : roles.some(({ role }) => role === Role.SALON_OWNER)
            ? SessionAudience.STAFF
            : SessionAudience.CUSTOMER,
      );
      return user;
    }

    const ownerLocationPath = () =>
      `dashboard/${DASHBOARD_PATHS.salons}/${ids.salon}/${DASHBOARD_PATHS.location}`;
    const adminQueuePath = () => `admin/${ADMIN_PATHS.locationVerifications}`;
    const decisionPath = (id: string) =>
      `admin/${ADMIN_PATHS.locationVerifications}/${id}/${ADMIN_PATHS.decision}`;

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
      const owner = await createUser('owner', []);
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name: `Location Verification ${run}`,
          slug: `location-verification-${run}`,
          cityId: city.id,
          addressLine: '1 Disposable Test Road',
          lat: 21.85,
          lng: 84.0,
          status: SalonStatus.ACTIVE,
          timezone: 'Asia/Kolkata',
          currency: 'INR',
        },
      });
      ids.salon = salon.id;
      await prisma.userRole.create({
        data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id },
      });
      auth.owner = tokens.signAccessToken(
        owner.id,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );

      const otherOwner = await createUser('otherOwner', []);
      const otherSalon = await prisma.salon.create({
        data: {
          ownerUserId: otherOwner.id,
          name: `Other Location ${run}`,
          slug: `other-location-${run}`,
          cityId: city.id,
          addressLine: '2 Disposable Test Road',
          lat: 20,
          lng: 80,
          status: SalonStatus.ACTIVE,
          currency: 'INR',
        },
      });
      ids.otherSalon = otherSalon.id;
      await prisma.userRole.create({
        data: {
          userId: otherOwner.id,
          role: Role.SALON_OWNER,
          salonId: otherSalon.id,
        },
      });
      auth.otherOwner = tokens.signAccessToken(
        otherOwner.id,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
      await createUser('customer', [{ role: Role.CUSTOMER, salonId: null }]);

      const sameActor = await createUser('sameActor', [
        { role: Role.SALON_OWNER, salonId: salon.id },
        { role: Role.PLATFORM_ADMIN, salonId: null },
      ]);
      auth.sameActor = tokens.signAccessToken(
        sameActor.id,
        [Role.PLATFORM_ADMIN],
        SessionAudience.ADMIN,
      );
      auth.sameActorOwner = tokens.signAccessToken(
        sameActor.id,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
      const reviewerA = await createUser('reviewerA', [
        { role: Role.PLATFORM_ADMIN, salonId: null },
      ]);
      auth.reviewerA = tokens.signAccessToken(
        reviewerA.id,
        [Role.PLATFORM_ADMIN],
        SessionAudience.ADMIN,
      );
      const reviewerB = await createUser('reviewerB', [
        { role: Role.PLATFORM_ADMIN, salonId: null },
      ]);
      auth.reviewerB = tokens.signAccessToken(
        reviewerB.id,
        [Role.PLATFORM_ADMIN],
        SessionAudience.ADMIN,
      );
    }, 120_000);

    afterAll(async () => {
      await app?.close();
    });

    it('keeps public coordinates unchanged until a distinct global admin approves', async () => {
      const before = await prisma.salon.findUniqueOrThrow({
        where: { id: ids.salon },
        select: { lat: true, lng: true },
      });
      const path = ownerLocationPath();
      const initial = await api('get', path, auth.owner).expect(200);
      expect(initial.body.current).toMatchObject({
        latitude: before.lat,
        longitude: before.lng,
        verification: 'UNVERIFIED',
        verifiedAt: null,
      });

      await api('get', path, auth.otherOwner).expect(403);
      await api('patch', path, auth.otherOwner)
        .send({ latitude: 22.5726, longitude: 88.3639, source: 'MAP_PIN' })
        .expect(403);
      await api('patch', path, auth.customer)
        .send({ latitude: 22.5726, longitude: 88.3639, source: 'MAP_PIN' })
        .expect(403);

      const submitted = await api('patch', path, auth.owner)
        .send({ latitude: 22.5726, longitude: 88.3639, source: 'MAP_PIN' })
        .expect(200);
      ids.firstProposal = submitted.body.id;
      expect(submitted.body.status).toBe('PENDING');
      expect(submitted.body.source).toBe('MAP_PIN');
      expect(
        await prisma.salon.findUniqueOrThrow({
          where: { id: ids.salon },
          select: { lat: true, lng: true },
        }),
      ).toEqual(before);

      const retry = await api('patch', path, auth.owner)
        .send({ latitude: 22.5726, longitude: 88.3639, source: 'MAP_PIN' })
        .expect(200);
      expect(retry.body.id).toBe(ids.firstProposal);
      expect(
        await prisma.salonLocationProposal.count({
          where: { salonId: ids.salon, status: 'PENDING' },
        }),
      ).toBe(1);

      await api('get', adminQueuePath(), auth.reviewerA)
        .expect(200)
        .then((res) => {
          const item = res.body.items.find(
            (candidate: { id: string }) => candidate.id === ids.firstProposal,
          );
          expect(item).toMatchObject({
            id: ids.firstProposal,
            submittedByUserId: ids.owner,
            salon: {
              id: ids.salon,
              currentLatitude: before.lat,
              currentLongitude: before.lng,
            },
          });
        });
      await api('get', adminQueuePath(), auth.owner).expect(403);
    });

    it('prevents self-review and atomically approves with an audit record', async () => {
      // The same dual-role principal uses a STAFF token to submit and a separate ADMIN token to
      // enter the review route; the service must still reject that principal's own review.
      // This does not rely on client-side role hiding or an invalid cross-audience token.
      const path = ownerLocationPath();
      const submitted = await api('patch', path, auth.sameActorOwner)
        .send({ latitude: 25.2048, longitude: 55.2708, source: 'GPS' })
        .expect(200);
      const proposalId = submitted.body.id as string;
      await api('post', decisionPath(proposalId), auth.sameActor)
        .send({ decision: 'APPROVED', note: 'Self-review must be denied.' })
        .expect(403);

      const approved = await api(
        'post',
        decisionPath(proposalId),
        auth.reviewerA,
      )
        .send({
          decision: 'APPROVED',
          note: 'Coordinates checked against owner evidence.',
        })
        .expect(201);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.salon.currentLatitude).toBe(25.2048);
      expect(approved.body.salon.currentLongitude).toBe(55.2708);
      const persistedProposal =
        await prisma.salonLocationProposal.findUniqueOrThrow({
          where: { id: proposalId },
          select: {
            reviewedByAdminId: true,
            reviewNote: true,
            reviewedAt: true,
          },
        });
      expect(persistedProposal).toMatchObject({
        reviewedByAdminId: ids.reviewerA,
        reviewNote: 'Coordinates checked against owner evidence.',
      });
      expect(persistedProposal.reviewedAt).toBeInstanceOf(Date);

      const stored = await prisma.salon.findUniqueOrThrow({
        where: { id: ids.salon },
        select: { lat: true, lng: true },
      });
      expect(stored).toEqual({ lat: 25.2048, lng: 55.2708 });
      const audit = await prisma.auditLog.findMany({
        where: { entityType: 'SalonLocationProposal', entityId: proposalId },
        select: { action: true, actorUserId: true, metadata: true },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'SALON_LOCATION_APPROVED',
        actorUserId: ids.reviewerA,
      });

      const current = await api('get', path, auth.owner).expect(200);
      expect(current.body.current).toMatchObject({
        latitude: 25.2048,
        longitude: 55.2708,
        verification: 'VERIFIED',
      });
    });

    it('allows one concurrent admin decision, preserves coordinates on rejection, and keeps history', async () => {
      const submitted = await api('patch', ownerLocationPath(), auth.owner)
        .send({ latitude: 40.7128, longitude: -74.006, source: 'MANUAL' })
        .expect(200);
      const proposalId = submitted.body.id as string;
      const decision = {
        decision: 'APPROVED',
        note: 'Independent reviewers race safely.',
      };
      const results = await Promise.all([
        api('post', decisionPath(proposalId), auth.reviewerA).send(decision),
        api('post', decisionPath(proposalId), auth.reviewerB).send(decision),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect(
        await prisma.salonLocationProposal.count({
          where: { id: proposalId, status: 'APPROVED' },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: {
            entityType: 'SalonLocationProposal',
            entityId: proposalId,
            action: 'SALON_LOCATION_APPROVED',
          },
        }),
      ).toBe(1);

      const stableLocation = await prisma.salon.findUniqueOrThrow({
        where: { id: ids.salon },
        select: { lat: true, lng: true },
      });
      const rejected = await api('patch', ownerLocationPath(), auth.owner)
        .send({ latitude: -33.8688, longitude: 151.2093, source: 'MAP_PIN' })
        .expect(200);
      await api('post', decisionPath(rejected.body.id), auth.reviewerB)
        .send({
          decision: 'REJECTED',
          note: 'Evidence did not establish the shop entrance.',
        })
        .expect(201);
      expect(
        await prisma.salon.findUniqueOrThrow({
          where: { id: ids.salon },
          select: { lat: true, lng: true },
        }),
      ).toEqual(stableLocation);
      expect(
        await prisma.salonLocationProposal.count({
          where: {
            salonId: ids.salon,
            status: { in: ['APPROVED', 'REJECTED'] },
          },
        }),
      ).toBe(3);
      await prisma.salon.update({
        where: { id: ids.salon },
        data: { lat: 1, lng: 1 },
      });
      const unverified = await api(
        'get',
        ownerLocationPath(),
        auth.owner,
      ).expect(200);
      expect(unverified.body.current).toMatchObject({
        latitude: 1,
        longitude: 1,
        verification: 'UNVERIFIED',
        verifiedAt: null,
      });
    });

    it('rejects invalid coordinates, short review notes, malformed cursors, and non-admin decisions', async () => {
      await api('patch', ownerLocationPath(), auth.owner)
        .send({ latitude: 90.1, longitude: 0, source: 'GPS' })
        .expect(400);
      await api('patch', ownerLocationPath(), auth.owner)
        .send({ latitude: 0, longitude: 0, source: 'UNKNOWN' })
        .expect(400);
      await api(
        'get',
        `${adminQueuePath()}?cursor=not-a-valid-cursor`,
        auth.reviewerA,
      ).expect(400);
      await api(
        'post',
        decisionPath('00000000-0000-0000-0000-000000000001'),
        auth.owner,
      )
        .send({ decision: 'APPROVED', note: 'Unauthorized review attempt.' })
        .expect(403);

      const pending = await api('patch', ownerLocationPath(), auth.owner)
        .send({ latitude: 12.9716, longitude: 77.5946, source: 'GPS' })
        .expect(200);
      await api('post', decisionPath(pending.body.id), auth.reviewerA)
        .send({ decision: 'APPROVED', note: 'x' })
        .expect(400);
      await api(
        'post',
        decisionPath('00000000-0000-0000-0000-000000000001'),
        auth.reviewerA,
      )
        .send({ decision: 'APPROVED', note: 'Proposal cannot be found.' })
        .expect(404);
    });

    it('enforces coordinate, lifecycle, and one-pending-proposal guards in PostgreSQL', async () => {
      const rawInsert = (
        salonId: string,
        latitude: number,
        status: 'PENDING' | 'APPROVED',
        pendingSlot: number | null,
      ) => prisma.$executeRaw`
      INSERT INTO salon_location_proposals
        (id, "salonId", latitude, longitude, source, status, "pendingSlot", "submittedByUserId")
      VALUES
        (${randomUUID()}, ${salonId}, ${latitude}, 1, 'GPS'::"SalonLocationSource",
         ${status}::"SalonLocationProposalStatus", ${pendingSlot}, ${ids.otherOwner})
    `;

      await expect(
        rawInsert(ids.otherSalon, 91, 'PENDING', 1),
      ).rejects.toThrow();
      await expect(
        rawInsert(ids.otherSalon, 20, 'PENDING', null),
      ).rejects.toThrow();
      await expect(
        rawInsert(ids.otherSalon, 20, 'APPROVED', null),
      ).rejects.toThrow();
      await rawInsert(ids.otherSalon, 20, 'PENDING', 1);
      await expect(
        rawInsert(ids.otherSalon, 20.1, 'PENDING', 1),
      ).rejects.toThrow();
      expect(
        await prisma.salonLocationProposal.count({
          where: { salonId: ids.otherSalon, status: 'PENDING' },
        }),
      ).toBe(1);
    });
  },
);
