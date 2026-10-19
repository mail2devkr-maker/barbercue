import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  DASHBOARD_PATHS,
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
  process.env.ALLOW_EXTERNAL_REVIEW_PROFILE_E2E === 'yes';
const describeDisposable =
  disposableDb && approvedRunner ? describe : describe.skip;

describeDisposable(
  'salon external review profiles (authenticated disposable PostgreSQL E2E)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokens: TokenService;
    const run = randomUUID();
    const ids: Record<string, string> = {};
    const auth: Record<string, string> = {};

    const api = (method: 'get' | 'put', path: string, token?: string) => {
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
          email: `review-profiles-${run}-${label}@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      for (const membership of roles) {
        await prisma.userRole.create({
          data: {
            userId: user.id,
            role: membership.role,
            salonId: membership.salonId,
          },
        });
      }
      ids[label] = user.id;
      auth[label] = tokens.signAccessToken(
        user.id,
        roles.map(({ role }) => role),
        roles.some(({ role }) => role === Role.SALON_OWNER)
          ? SessionAudience.STAFF
          : SessionAudience.CUSTOMER,
      );
      return user;
    }

    const reviewsPath = (salonId: string) =>
      `dashboard/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.reviews}`;
    const profilesPath = (salonId: string) =>
      `dashboard/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.reviewProfiles}`;

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
          name: `Review Profiles ${run}`,
          slug: `review-profiles-${run}`,
          cityId: city.id,
          addressLine: '1 Disposable Review Road',
          status: 'ACTIVE',
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
          name: `Other Review Profiles ${run}`,
          slug: `other-review-profiles-${run}`,
          cityId: city.id,
          addressLine: '2 Disposable Review Road',
          status: 'ACTIVE',
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
      const staff = await createUser('staff', [
        { role: Role.SALON_STAFF, salonId: salon.id },
      ]);
      auth.staff = tokens.signAccessToken(
        staff.id,
        [Role.SALON_STAFF],
        SessionAudience.STAFF,
      );
    }, 120_000);

    afterAll(async () => {
      // The workflow provisions a throw-away PostgreSQL service for this suite. Leave its synthetic
      // audit history intact; the service is discarded with the job rather than deleting evidence.
      await app?.close();
    });

    it('returns FastQue reviews and explicit provider states without merging external identities', async () => {
      const ownReviews = await api(
        'get',
        reviewsPath(ids.salon),
        auth.owner,
      ).expect(200);
      expect(ownReviews.body).toMatchObject({
        source: 'FASTQUE',
        items: [],
        nextCursor: null,
        sources: [
          { source: 'FASTQUE', state: 'CONNECTED', profileUrl: null },
          { source: 'GOOGLE', state: 'UNAVAILABLE', profileUrl: null },
          { source: 'FACEBOOK', state: 'UNAVAILABLE', profileUrl: null },
          { source: 'INSTAGRAM', state: 'UNAVAILABLE', profileUrl: null },
        ],
      });
      await api(
        'get',
        `${reviewsPath(ids.salon)}?source=NOT_A_PROVIDER`,
        auth.owner,
      ).expect(400);
      const google = await api(
        'get',
        `${reviewsPath(ids.salon)}?source=GOOGLE`,
        auth.owner,
      ).expect(200);
      expect(google.body).toMatchObject({
        source: 'GOOGLE',
        items: [],
        nextCursor: null,
      });
    });

    it('validates profile ownership, persists only vetted links, and audits providers without URLs', async () => {
      await api('get', profilesPath(ids.salon)).expect(401);
      await api('get', profilesPath(ids.salon), auth.customer).expect(403);
      await api('get', profilesPath(ids.salon), auth.staff).expect(403);
      await api('get', profilesPath(ids.salon), auth.otherOwner).expect(403);

      await api('put', profilesPath(ids.salon), auth.owner)
        .send({ googleUrl: 'https://google.com.evil.example/maps/place/shop' })
        .expect(400);
      await api('put', profilesPath(ids.salon), auth.owner)
        .send({ googleUrl: 'http://g.page/shop' })
        .expect(400);
      await api('put', profilesPath(ids.salon), auth.otherOwner)
        .send({ googleUrl: 'https://g.page/other-shop' })
        .expect(403);

      const saved = await api('put', profilesPath(ids.salon), auth.owner)
        .send({
          googleUrl: 'https://g.page/fastque-shop',
          facebookUrl: 'https://www.facebook.com/fastque.shop',
        })
        .expect(200);
      expect(saved.body.sources).toEqual([
        { source: 'FASTQUE', state: 'CONNECTED', profileUrl: null },
        {
          source: 'GOOGLE',
          state: 'LINK_ONLY',
          profileUrl: 'https://g.page/fastque-shop',
        },
        {
          source: 'FACEBOOK',
          state: 'LINK_ONLY',
          profileUrl: 'https://www.facebook.com/fastque.shop',
        },
        { source: 'INSTAGRAM', state: 'UNAVAILABLE', profileUrl: null },
      ]);

      const externalPage = await api(
        'get',
        `${reviewsPath(ids.salon)}?source=GOOGLE`,
        auth.owner,
      ).expect(200);
      expect(externalPage.body.items).toEqual([]);
      expect(externalPage.body.sources[1].state).toBe('LINK_ONLY');

      const cleared = await api('put', profilesPath(ids.salon), auth.owner)
        .send({
          googleUrl: null,
          instagramUrl: 'https://www.instagram.com/fastque.shop/',
        })
        .expect(200);
      expect(cleared.body.sources).toMatchObject([
        { source: 'FASTQUE', state: 'CONNECTED' },
        { source: 'GOOGLE', state: 'UNAVAILABLE', profileUrl: null },
        { source: 'FACEBOOK', state: 'LINK_ONLY' },
        { source: 'INSTAGRAM', state: 'LINK_ONLY' },
      ]);

      const audit = await prisma.auditLog.findMany({
        where: {
          action: 'SALON_REVIEW_PROFILES_UPDATED',
          entityId: ids.salon,
        },
      });
      expect(audit).toHaveLength(2);
      expect(JSON.stringify(audit)).not.toContain('https://');
      expect(
        await prisma.salonReviewProfile.findUnique({
          where: { salonId: ids.otherSalon },
        }),
      ).toBeNull();
    });
  },
);
