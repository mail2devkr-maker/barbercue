import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
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

const databaseUrl = process.env.DATABASE_URL ?? '';
let isDisposableLocalDatabase = false;
try {
  const parsed = new URL(databaseUrl);
  isDisposableLocalDatabase =
    ['127.0.0.1', 'localhost'].includes(parsed.hostname) &&
    parsed.pathname.replace(/^\//, '').includes('owner_ops');
} catch {
  // A malformed or absent URL must never cause fixture writes.
}
const maybe = isDisposableLocalDatabase ? describe : describe.skip;

maybe(
  'Salon description suggestions (authenticated HTTP, disposable PostgreSQL)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let ownerToken: string;
    let outsiderToken: string;
    let salonId: string;
    let descriptionBefore: string | null;
    let createdSalonIds: string[] = [];
    let createdUserIds: string[] = [];
    let createdRoleIds: string[] = [];

    const run = randomUUID().slice(0, 8);

    beforeAll(async () => {
      const fixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = fixture.createNestApplication();
      app.setGlobalPrefix('api/v1');
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      prisma = app.get(PrismaService);
      const tokens = app.get(TokenService);
      const city = await prisma.city.findFirstOrThrow({
        where: { slug: 'jharsuguda' },
      });

      const owner = await prisma.user.create({
        data: {
          email: `description-owner-${run}@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      const outsider = await prisma.user.create({
        data: {
          email: `description-outsider-${run}@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      createdUserIds = [owner.id, outsider.id];

      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name: `Synthetic Description Salon ${run}`,
          slug: `synthetic-description-${run}`,
          cityId: city.id,
          addressLine: '1 Disposable Test Road',
          status: SalonStatus.ACTIVE,
          description: 'Original owner description remains unchanged.',
        },
      });
      const otherSalon = await prisma.salon.create({
        data: {
          ownerUserId: outsider.id,
          name: `Synthetic Other Salon ${run}`,
          slug: `synthetic-other-description-${run}`,
          cityId: city.id,
          addressLine: '2 Disposable Test Road',
          status: SalonStatus.ACTIVE,
        },
      });
      createdSalonIds = [salon.id, otherSalon.id];
      salonId = salon.id;
      descriptionBefore = salon.description;

      const ownerRole = await prisma.userRole.create({
        data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id },
      });
      const outsiderRole = await prisma.userRole.create({
        data: {
          userId: outsider.id,
          role: Role.SALON_OWNER,
          salonId: otherSalon.id,
        },
      });
      createdRoleIds = [ownerRole.id, outsiderRole.id];
      ownerToken = tokens.signAccessToken(
        owner.id,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
      outsiderToken = tokens.signAccessToken(
        outsider.id,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
    }, 120_000);

    afterAll(async () => {
      if (prisma) {
        if (createdRoleIds.length) {
          await prisma.userRole.deleteMany({
            where: { id: { in: createdRoleIds } },
          });
        }
        if (createdSalonIds.length) {
          await prisma.salon.deleteMany({
            where: { id: { in: createdSalonIds } },
          });
        }
        if (createdUserIds.length) {
          await prisma.user.deleteMany({
            where: { id: { in: createdUserIds } },
          });
        }
      }
      await app?.close();
    });

    it('fails closed for the owner, denies a different salon owner, and rejects unrecognized body fields', async () => {
      const route = `/api/v1/dashboard/salons/${salonId}/description/suggestions`;
      const ownerResponse = await request(app.getHttpServer())
        .post(route)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          language: 'en',
          tone: 'professional',
          ownerAttestedHighlights: [],
        })
        .expect(503);
      expect(ownerResponse.body.error.code).toBe(
        'SALON_DESCRIPTION_PROVIDER_NOT_CONFIGURED',
      );

      await request(app.getHttpServer())
        .post(route)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({})
        .expect(403);

      await request(app.getHttpServer())
        .post(route)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ language: 'en', provider: 'external' })
        .expect(400);

      const persisted = await prisma.salon.findUniqueOrThrow({
        where: { id: salonId },
        select: { description: true },
      });
      expect(persisted.description).toBe(descriptionBefore);
    }, 60_000);
  },
);
