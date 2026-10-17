import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ContactConsentSource,
  ContactImportValidationStatus as Status,
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

/** Real authenticated requests against only the disposable loopback PostgreSQL CI service. */
const databaseUrl = process.env.DATABASE_URL ?? '';
const describeDisposable = /@(127\.0\.0\.1|localhost)[:/]/i.test(databaseUrl)
  ? describe
  : describe.skip;

describeDisposable(
  'Customer contact import preview (PostgreSQL HTTP E2E)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokens: TokenService;
    const run = randomUUID();
    const ids: Record<string, string> = {};
    const auth: Record<string, string> = {};
    const path = (salonId: string) =>
      `dashboard/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.contacts}/preview`;

    async function createUser(
      label: string,
      role: Role,
      salonId: string | null,
      phone?: string,
    ) {
      const user = await prisma.user.create({
        data: {
          email: `contact-preview-${run}-${label}@example.test`,
          phone,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      // Salon-owner role scope is attached only after its salon fixture exists below.
      if (role === Role.CUSTOMER || salonId !== null) {
        await prisma.userRole.create({
          data: { userId: user.id, role, salonId },
        });
      }
      ids[label] = user.id;
      auth[label] = tokens.signAccessToken(
        user.id,
        [role],
        role === Role.SALON_OWNER
          ? SessionAudience.STAFF
          : SessionAudience.CUSTOMER,
      );
      return user;
    }

    const api = (salonId: string, token?: string) => {
      const req = request(app.getHttpServer()).post(`/api/v1/${path(salonId)}`);
      if (token) req.set('Authorization', `Bearer ${token}`);
      return req;
    };

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
      const owner = await createUser('owner', Role.SALON_OWNER, null);
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name: `Contact Preview ${run}`,
          slug: `contact-preview-${run}`,
          cityId: city.id,
          addressLine: 'Disposable Test Road',
          status: SalonStatus.ACTIVE,
          currency: 'INR',
          timezone: 'Asia/Kolkata',
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

      const otherOwner = await createUser('otherOwner', Role.SALON_OWNER, null);
      const otherSalon = await prisma.salon.create({
        data: {
          ownerUserId: otherOwner.id,
          name: `Other Contact Preview ${run}`,
          slug: `other-contact-preview-${run}`,
          cityId: city.id,
          addressLine: 'Other Disposable Test Road',
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

      const customer = await createUser(
        'customer',
        Role.CUSTOMER,
        null,
        '+919876543210',
      );
      auth.customer = tokens.signAccessToken(
        customer.id,
        [Role.CUSTOMER],
        SessionAudience.CUSTOMER,
      );
    }, 120_000);

    afterAll(async () => {
      await app?.close();
    });

    it('validates consented contacts transiently without returning PII, account existence, or delivery claims', async () => {
      const before = {
        users: await prisma.user.count(),
        salons: await prisma.salon.count(),
        audits: await prisma.auditLog.count(),
      };
      const response = await api(ids.salon, auth.owner)
        .send({
          contacts: [
            {
              phone: '+919876543210', // a synthetic existing customer; no account lookup is exposed
              consent: {
                granted: true,
                source: ContactConsentSource.VERBAL,
                capturedAt: new Date(Date.now() - 60_000).toISOString(),
              },
            },
            {
              phone: '9876543210', // normalizes to the same number and is deduplicated in-batch
              consent: {
                granted: true,
                source: ContactConsentSource.IN_PERSON,
                capturedAt: new Date(Date.now() - 60_000).toISOString(),
              },
            },
            { phone: '+919811122233' },
          ],
        })
        .expect(201);

      expect(response.body).toMatchObject({
        previewOnly: true,
        invitationEligibility: 'NOT_EVALUATED',
        dispatchEnabled: false,
        dispatchBlockedReason:
          'CONSENT_SUPPRESSION_AND_PROVIDER_GATES_REQUIRED',
        summary: {
          total: 3,
          validatedForReview: 1,
          duplicateInBatch: 1,
          consentRequired: 1,
        },
        items: [
          { index: 0, status: Status.VALIDATED_FOR_REVIEW },
          { index: 1, status: Status.DUPLICATE_IN_BATCH },
          { index: 2, status: Status.CONSENT_REQUIRED },
        ],
      });
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('+919876543210');
      expect(serialized).not.toContain('9876543210');
      expect(response.body).not.toHaveProperty('existingAccount');
      expect(await prisma.user.count()).toBe(before.users);
      expect(await prisma.salon.count()).toBe(before.salons);
      expect(await prisma.auditLog.count()).toBe(before.audits);
    });

    it('requires an authenticated owner of the exact salon and rejects malformed batches without echoing input', async () => {
      const body = { contacts: [{ phone: '+919812345678' }] };
      await api(ids.salon).send(body).expect(401);
      await api(ids.salon, auth.customer).send(body).expect(403);
      await api(ids.salon, auth.otherOwner).send(body).expect(403);

      const invalidPhone = 'private-invalid-phone-value';
      const malformed = await api(ids.salon, auth.owner)
        .send({
          contacts: [
            {
              phone: invalidPhone,
              unexpected: true,
            },
          ],
        })
        .expect(400);
      expect(JSON.stringify(malformed.body)).not.toContain(invalidPhone);
    });

    it('marks incomplete and future consent evidence and invalid numbers as non-reviewable', async () => {
      const response = await api(ids.salon, auth.owner)
        .send({
          contacts: [
            {
              phone: '+919812345678',
              consent: { granted: true },
            },
            {
              phone: '+919812345679',
              consent: {
                granted: true,
                source: ContactConsentSource.WRITTEN,
                capturedAt: new Date(Date.now() + 60_000).toISOString(),
              },
            },
            { phone: 'not-a-phone' },
          ],
        })
        .expect(201);
      expect(
        response.body.items.map((item: { status: string }) => item.status),
      ).toEqual([
        Status.CONSENT_EVIDENCE_INCOMPLETE,
        Status.CONSENT_TIMESTAMP_INVALID,
        Status.INVALID_PHONE,
      ]);
    });
  },
);
